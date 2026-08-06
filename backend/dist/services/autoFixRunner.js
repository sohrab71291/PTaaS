"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAutoFixRun = registerAutoFixRun;
exports.getAutoFixRun = getAutoFixRun;
exports.clearAutoFixRun = clearAutoFixRun;
exports.attemptAutoFix = attemptAutoFix;
const jobDispatcher_1 = require("./jobDispatcher");
const aiGenerate_1 = require("../routes/aiGenerate");
const anthropicClient_1 = require("./anthropicClient");
// Tracks in-flight auto-fix/retry executions, keyed by executionId. Only
// needed for the lifetime of a running job — nothing here is persisted, the
// same way console logs aren't persisted (see executionLogBuffers in index.ts).
const activeRuns = new Map();
function registerAutoFixRun(executionId, run) {
    activeRuns.set(executionId, { ...run, attempt: 1 });
}
function getAutoFixRun(executionId) {
    return activeRuns.get(executionId);
}
function clearAutoFixRun(executionId) {
    activeRuns.delete(executionId);
}
const MAX_LOG_CHARS = 12000;
function buildFixInstruction(failure) {
    const parts = [
        'This k6 script just failed when executed. Analyze the failure evidence below and rewrite the script to fix the root cause(s) so it runs successfully. Preserve the test intent (endpoints, load profile, checks, thresholds) — fix bugs, not scope.',
    ];
    if (failure.message)
        parts.push(`Error message:\n${failure.message}`);
    if (failure.exitCode != null)
        parts.push(`k6 exit code: ${failure.exitCode}`);
    const failedThresholds = (failure.thresholdResults ?? []).filter((t) => !t.passed);
    if (failedThresholds.length) {
        parts.push(`Failed thresholds:\n${failedThresholds.map((t) => `- ${t.metric}: ${t.condition}`).join('\n')}`);
    }
    const failedChecks = (failure.checkResults ?? []).filter((c) => (c.fails ?? 0) > 0);
    if (failedChecks.length) {
        parts.push(`Checks with failures:\n${failedChecks.map((c) => `- ${c.name}: ${c.passes ?? 0} pass / ${c.fails ?? 0} fail`).join('\n')}`);
    }
    if (failure.consoleTail?.trim()) {
        const tail = failure.consoleTail.length > MAX_LOG_CHARS
            ? `…(truncated, showing last ${MAX_LOG_CHARS} chars)…\n` + failure.consoleTail.slice(-MAX_LOG_CHARS)
            : failure.consoleTail;
        parts.push(`Console/error output from the run:\n${tail}`);
    }
    return parts.join('\n\n');
}
// Diagnoses the failure with Claude, rewrites the script, and redispatches
// the SAME execution id to the same agent config — the caller (index.ts) is
// responsible for skipping its normal "job finished" finalization when this
// succeeds, since the job is effectively still in progress.
async function attemptAutoFix(executionId, failure, onLog) {
    const run = activeRuns.get(executionId);
    if (!run)
        return { ok: false, reason: 'no active auto-fix run' };
    if (run.attempt >= run.maxAttempts)
        return { ok: false, reason: 'max attempts reached' };
    if (!(0, anthropicClient_1.hasAnthropicCredentials)())
        return { ok: false, reason: 'Anthropic API credentials not configured' };
    // Claude streams the rewritten script token-by-token via 'chunk' events —
    // line-buffer those (plus 'status' events) so the console shows the fix
    // being generated in real time instead of one opaque "please wait".
    let buffer = '';
    const flushLines = (force = false) => {
        if (!onLog) {
            buffer = force ? '' : buffer;
            return;
        }
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (line.trim())
                onLog(line);
        }
        if (force && buffer.trim()) {
            onLog(buffer);
            buffer = '';
        }
    };
    const onEvent = (type, data) => {
        if (type === 'chunk' && typeof data?.text === 'string') {
            buffer += data.text;
            flushLines();
        }
        else if (type === 'status' && typeof data?.message === 'string') {
            flushLines(true);
            onLog?.(data.message);
        }
    };
    let fixedScript;
    try {
        onLog?.('Analyzing failure and asking Claude to rewrite the script…');
        fixedScript = await (0, aiGenerate_1.autoFixScript)(run.script, buildFixInstruction(failure), onEvent);
        flushLines(true);
    }
    catch (err) {
        flushLines(true);
        return { ok: false, reason: err.message || 'AI fix failed' };
    }
    run.script = fixedScript;
    run.attempt += 1;
    activeRuns.set(executionId, run);
    try {
        const newAgentId = await (0, jobDispatcher_1.dispatchJobToAgent)(run.agentId, executionId, fixedScript, run.config);
        run.agentId = newAgentId;
        activeRuns.set(executionId, run);
    }
    catch (err) {
        return { ok: false, reason: err.message || 'Failed to redispatch job' };
    }
    return { ok: true, nextAttempt: run.attempt };
}
