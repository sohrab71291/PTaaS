import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SloDefinition, SLO_METRIC_OPTIONS } from '../types/slo';
import { useNavigate } from 'react-router-dom';
import {
  Play, Square, Terminal, AlertCircle,
  CheckCircle, Loader2, ExternalLink, Copy, FileText, Sparkles, Send
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Stage, EnvVar } from '../lib/testProfiles';
import { useExecution, ConsoleLine, ExecutionStatus } from '../contexts/ExecutionContext';

// ─── Types ───────────────────────────────────────────────────────────────────

type ScriptSource = 'authoring' | 'upload' | 'paste';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const colorForPct = (pct: number) =>
  pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-green-500';

const statusConfig: Record<ExecutionStatus, { label: string; color: string; icon: React.ReactNode }> = {
  idle:     { label: 'IDLE',     color: 'bg-gray-400',   icon: null },
  starting: { label: 'STARTING', color: 'bg-yellow-400', icon: <Loader2 size={12} className="animate-spin" /> },
  running:  { label: 'RUNNING',  color: 'bg-green-500',  icon: <span className="w-2 h-2 rounded-full bg-white animate-pulse inline-block" /> },
  complete: { label: 'COMPLETE', color: 'bg-blue-500',   icon: <CheckCircle size={12} /> },
  error:    { label: 'ERROR',    color: 'bg-red-500',    icon: <AlertCircle size={12} /> },
  stopped:  { label: 'STOPPED',  color: 'bg-gray-500',   icon: null },
};

const ResourceBar: React.FC<{ label: string; pct: number; sub: string }> = ({ label, pct, sub }) => (
  <div className="flex items-center gap-3">
    <span className="text-xs text-gray-500 w-28 shrink-0">{label}</span>
    <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${colorForPct(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
    <span className="text-xs text-gray-700 font-medium w-10 text-right">{pct.toFixed(1)}%</span>
    <span className="text-xs text-gray-400 w-20">{sub}</span>
  </div>
);

const BigMetricCard: React.FC<{ label: string; value: string; sub?: string; highlight?: boolean }> = ({
  label, value, sub, highlight,
}) => (
  <div className={`rounded-lg p-4 flex flex-col gap-1 border shadow-sm ${highlight ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
    <span className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</span>
    <span className={`text-2xl font-bold ${highlight ? 'text-red-600' : 'text-gray-900'}`}>{value}</span>
    {sub && <span className="text-xs text-gray-400">{sub}</span>}
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export const Executor: React.FC = () => {
  const navigate = useNavigate();

  // Script source
  const [scriptSource, setScriptSource] = useState<ScriptSource>('authoring');
  const [pastedScript, setPastedScript] = useState('');
  const [uploadedScript, setUploadedScript] = useState('');
  const [authoringScript, setAuthoringScript] = useState('');
  const [generatedScriptMeta, setGeneratedScriptMeta] = useState<{ testType: string; complexity: string; source: string; generatedAt: string } | null>(null);
  const [testName, setTestName] = useState('');
  const [slos, setSlos] = useState<SloDefinition[]>([]);
  const [specId, setSpecId] = useState<string | null>(null);

  // Load profile
  const [profileType, setProfileType] = useState<'staged' | 'constant'>('staged');
  const [stages, setStages] = useState<Stage[]>([
    { target: 10, duration: '2m' },
    { target: 50, duration: '5m' },
    { target: 0,  duration: '1m' },
  ]);
  const [constantVus, setConstantVus] = useState(10);
  const [constantDuration, setConstantDuration] = useState('1m');
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);

  // Agent auto-fix & retry: on failure, the backend asks Claude to diagnose
  // and rewrite the script, then re-runs it — repeating until it succeeds or
  // maxAttempts total runs is reached.
  const [autoFix, setAutoFix] = useState(true);
  const [autoFixMaxAttemptsInput, setAutoFixMaxAttemptsInput] = useState(3);

  // Execution state lives in ExecutionContext (above the router) so an in-progress
  // run survives navigating away from this page — see ExecutionStatusPopup.
  const {
    status, executionId, liveMetrics, systemMetrics, consoleLines, summary,
    k6NotFound, sloResults, startExecution, stopExecution,
    autoFixAttempt, autoFixMaxAttempts, autoFixedScript,
  } = useExecution();

  const consoleBoxRef = useRef<HTMLDivElement>(null);

  const [autoRunPending, setAutoRunPending] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem('generatedK6Script');
    if (stored) setAuthoringScript(stored);
    const meta = sessionStorage.getItem('generatedK6ScriptMeta');
    if (meta) { try { setGeneratedScriptMeta(JSON.parse(meta)); } catch {} }
    const name = sessionStorage.getItem('generatedK6ScriptName');
    if (name) setTestName(name);
    const storedSlos = sessionStorage.getItem('generatedK6ScriptSlos');
    if (storedSlos) { try { setSlos(JSON.parse(storedSlos)); } catch {} }
    const storedSpecId = sessionStorage.getItem('generatedK6ScriptSpecId');
    if (storedSpecId) setSpecId(storedSpecId);
    const storedProfile = sessionStorage.getItem('generatedK6ScriptProfile');
    if (storedProfile) {
      try {
        const p = JSON.parse(storedProfile);
        if (p.profileType) setProfileType(p.profileType);
        if (p.stages) setStages(p.stages);
        if (p.constantVus) setConstantVus(p.constantVus);
        if (p.constantDuration) setConstantDuration(p.constantDuration);
      } catch {}
    }
    const storedEnvVars = sessionStorage.getItem('generatedK6ScriptEnvVars');
    if (storedEnvVars) { try { setEnvVars(JSON.parse(storedEnvVars)); } catch {} }

    if (sessionStorage.getItem('executorAutoRun') === 'true') {
      sessionStorage.removeItem('executorAutoRun');
      setAutoRunPending(true);
    }
  }, []);

  // Scroll only the console box's own scrollTop — never scrollIntoView(), which
  // can walk up and scroll ancestor scrollables (the whole page) and yank the
  // user's scroll position back here on every new line during a running execution.
  useEffect(() => {
    const box = consoleBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [consoleLines]);

  // Auto-run when navigated here from Schedules "Run Now"
  useEffect(() => {
    if (autoRunPending && authoringScript) {
      setAutoRunPending(false);
      // Small delay so React can flush all the state sets from the init effect
      setTimeout(() => handleExecute(), 100);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunPending, authoringScript]);

  const getActiveScript = (): string => {
    if (scriptSource === 'authoring') return authoringScript;
    if (scriptSource === 'upload')    return uploadedScript;
    return pastedScript;
  };

  const handleExecute = async () => {
    const script = getActiveScript();
    if (!script.trim()) return;

    const envObj: Record<string, string> = {};
    envVars.filter(e => e.key.trim()).forEach(e => { envObj[e.key] = e.value; });

    await startExecution({
      script, profileType, stages, constantVus, constantDuration,
      envVars: envObj, testName, slos, specId,
      autoFix, maxAttempts: autoFixMaxAttemptsInput,
    });
  };

  const handleStop = stopExecution;

  // Sync executor's load-profile settings back to the test spec after a run
  // finishes (purely local convenience — unrelated to global execution tracking).
  useEffect(() => {
    if ((status === 'complete' || status === 'stopped') && executionId && specId) {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const authHeaders = { ...headers, 'Content-Type': 'application/json' };
      fetch(`/api/test-specs/${specId}`, { headers })
        .then(r => r.json())
        .then(currentSpec => {
          const updatedLoadProfile = {
            ...currentSpec.loadProfile,
            type: profileType,
            ...(profileType === 'staged'
              ? { stages }
              : { stages: [{ target: constantVus, duration: constantDuration }] }),
            lastExecutorScriptSource: scriptSource,
          };
          return fetch(`/api/test-specs/${specId}`, {
            method: 'PUT',
            headers: authHeaders,
            body: JSON.stringify({ ...currentSpec, loadProfile: updatedLoadProfile }),
          });
        })
        .catch(() => {});
    }
  }, [status, executionId]);

  // When the backend's auto-fix diagnoses and rewrites a failing script mid-run,
  // reflect that rewritten script everywhere the original one lived — the local
  // editor state (whichever source produced it), sessionStorage (so a refresh of
  // this page doesn't lose it), and the test suite's saved spec (so future runs
  // from Test Authoring pick up the fix instead of the stale, broken script).
  useEffect(() => {
    if (!autoFixedScript) return;
    if (scriptSource === 'authoring') setAuthoringScript(autoFixedScript);
    else if (scriptSource === 'upload') setUploadedScript(autoFixedScript);
    else setPastedScript(autoFixedScript);
    sessionStorage.setItem('generatedK6Script', autoFixedScript);

    if (specId) {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      fetch(`/api/test-specs/${specId}`, { headers })
        .then(r => r.json())
        .then(currentSpec => fetch(`/api/test-specs/${specId}`, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...currentSpec, generatedScript: autoFixedScript }),
        }))
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFixedScript]);

  const onDrop = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (e) => setUploadedScript(String(e.target?.result || ''));
    reader.readAsText(f);
  }, []);

  const { getRootProps: getJsRootProps, getInputProps: getJsInputProps, isDragActive: isJsDragActive } = useDropzone({
    onDrop,
    accept: { 'application/javascript': ['.js'], 'text/plain': ['.js', '.txt'] },
    multiple: false,
  });

  const statusCfg  = statusConfig[status];
  const isExecuting = status === 'running' || status === 'starting';

  // k6 tags every console.log() call with `source=console` and wraps the
  // original message in `msg="..."` — these are our own auto-injected
  // request/response log lines (method/URL, headers, payload, status, body).
  // k6 often routes them through stderr depending on log-level config, which
  // would otherwise make them red via the isStderr check below even though
  // they're plain data, not a failure — so this check takes priority.
  const isApiCallData = (text: string) =>
    /source=console/.test(text) &&
    /msg="(\[(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\]|\s*(Request Headers|Request Payload|Response Status|Response Headers|Response Body):)/i.test(text);

  const consoleLabelColor = (line: ConsoleLine) => {
    const t = line.text;
    // API call request/response data — always white, never red, even when via stderr
    if (isApiCallData(t)) return 'text-white';

    // k6 progress lines ("running (0m01.0s), 10/10 VUs, 342 complete ...")
    // and scenario summary lines ("default ✓ [ 100% ] 10 VUs 1m0s") —
    // these are informational, not failures, even though k6 emits them on stderr.
    if (/^running\s+\(/i.test(t))       return 'text-gray-400';
    if (/^\s*\w+\s+[✓✗]\s+\[/.test(t)) return /✓/.test(t) ? 'text-green-400' : 'text-red-400';

    // k6 banner / init lines (Grafana k6 header, "execution:", "scenarios:", "script:", "output:")
    if (/^\s*(\/\\|execution:|script:|output:|scenarios:|default\s+\[)/i.test(t)) return 'text-gray-400';

    // PerfOps internal status messages
    if (/^\[PerfOps\]/.test(t))         return /⚠|error|fail/i.test(t) ? 'text-yellow-400' : 'text-green-400';

    // Genuine k6 pass/fail threshold summary lines
    if (/✓\s+(http_|checks|vus|iteration)/i.test(t)) return 'text-green-400';
    if (/✗\s+(http_|checks|vus|iteration)/i.test(t)) return 'text-red-400';

    // Explicit error/failure content — but NOT metric labels like "Error rate:" or "failures:"
    if (/✗|\berror\b(?! rate)|\bfailed\b|\bfail\b(?!ures)/i.test(t)) return 'text-red-400';

    // All other stderr is gray, not red — most k6 output goes through stderr
    // by design (it's not an error channel), so showing it red is misleading.
    return 'text-gray-400';
  };

  const [logsCopied, setLogsCopied] = useState(false);

  // ── AI Troubleshooting ──────────────────────────────────────────────────
  const [troubleshootContext, setTroubleshootContext] = useState('');
  const [troubleshootAnswer, setTroubleshootAnswer] = useState('');
  const [troubleshootStatus, setTroubleshootStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [troubleshootError, setTroubleshootError] = useState('');
  const troubleshootAbortRef = useRef<AbortController | null>(null);

  const handleTroubleshoot = async () => {
    if (!troubleshootContext.trim() && consoleLines.length === 0) return;

    setTroubleshootStatus('loading');
    setTroubleshootAnswer('');
    setTroubleshootError('');
    troubleshootAbortRef.current = new AbortController();

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/executor/troubleshoot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          context: troubleshootContext,
          script: getActiveScript(),
          consoleLogs: consoleLines.map(l => l.text).join('\n'),
          summary,
        }),
        signal: troubleshootAbortRef.current.signal,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Request failed');
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'chunk') {
              accumulated += event.text;
              setTroubleshootAnswer(accumulated);
            } else if (event.type === 'complete') {
              setTroubleshootAnswer(event.message || accumulated);
              setTroubleshootStatus('done');
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch (parseErr: any) {
            if (parseErr.message !== 'Unexpected end of JSON input') throw parseErr;
          }
        }
      }
      setTroubleshootStatus(prev => (prev === 'loading' ? 'done' : prev));
    } catch (err: any) {
      if (err.name === 'AbortError') { setTroubleshootStatus('idle'); return; }
      setTroubleshootStatus('error');
      setTroubleshootError(err.message);
    }
  };

  const handleCopyLogs = () => {
    const text = consoleLines.map(l => l.text).join('\n');
    navigator.clipboard.writeText(text);
    setLogsCopied(true);
    setTimeout(() => setLogsCopied(false), 2000);
  };

  // Pulls the actual console.log() message out of k6's logger wrapper
  // (`time="..." level=info msg="<this>" source=console`) and decodes the
  // Go-style backslash escaping — close enough to JSON string escaping that
  // wrapping in quotes and JSON.parse'ing it works for normal text.
  const decodeConsoleMessage = (text: string): string | null => {
    const match = text.match(/msg="((?:\\.|[^"\\])*)"\s*source=console/);
    if (!match) return null;
    try { return JSON.parse('"' + match[1] + '"'); } catch { return match[1]; }
  };

  // Reassembles each auto-injected request/response log (currently 6
  // separate console.log lines per call) into one clearly separated,
  // labeled block, instead of a flat unspaced stream of lines — so each API
  // call reads as a single unit and consecutive calls are visually distinct.
  const formatRawLogs = (lines: ConsoleLine[]): string => {
    // Plain ASCII, not a Unicode box-drawing character — the blob opened via
    // handleOpenRawLogs has no charset declared, so non-ASCII characters can
    // get mis-decoded into garbled bytes depending on the browser's guess.
    const SEP = '-'.repeat(72);
    const out: string[] = [];
    let pending: Partial<Record<'method' | 'url' | 'reqHeaders' | 'reqPayload' | 'resStatus' | 'resHeaders' | 'resBody', string>> | null = null;

    const flush = () => {
      if (!pending) return;
      out.push(SEP);
      out.push(`${pending.method ?? ''} ${pending.url ?? ''}`.trim());
      out.push('');
      out.push('  Request');
      out.push(`    Headers: ${pending.reqHeaders ?? '(none)'}`);
      out.push(`    Payload: ${pending.reqPayload ?? '(none)'}`);
      out.push('');
      out.push('  Response');
      out.push(`    Status:  ${pending.resStatus ?? '(none)'}`);
      out.push(`    Headers: ${pending.resHeaders ?? '(none)'}`);
      out.push(`    Body:    ${pending.resBody ?? '(none)'}`);
      out.push(SEP);
      out.push('');
      pending = null;
    };

    for (const line of lines) {
      const msg = decodeConsoleMessage(line.text);
      if (msg == null) { flush(); out.push(line.text); continue; }

      const callMatch = msg.match(/^\[(\w+)\]\s+(.*)$/);
      if (callMatch) { flush(); pending = { method: callMatch[1], url: callMatch[2] }; continue; }
      if (!pending) { out.push(msg); continue; }

      if (/^\s*Request Headers:/.test(msg))       pending.reqHeaders = msg.replace(/^\s*Request Headers:\s*/, '');
      else if (/^\s*Request Payload:/.test(msg))  pending.reqPayload = msg.replace(/^\s*Request Payload:\s*/, '');
      else if (/^\s*Response Status:/.test(msg))  pending.resStatus  = msg.replace(/^\s*Response Status:\s*/, '');
      else if (/^\s*Response Headers:/.test(msg)) pending.resHeaders = msg.replace(/^\s*Response Headers:\s*/, '');
      else if (/^\s*Response Body:/.test(msg))   { pending.resBody   = msg.replace(/^\s*Response Body:\s*/, ''); flush(); }
      else out.push(msg);
    }
    flush();
    return out.join('\n');
  };

  const handleOpenRawLogs = () => {
    const text = formatRawLogs(consoleLines);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const inputCls = "w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder-gray-400";
  const labelCls = "block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider";

  // Compute average k6 CPU/memory from history for the post-run display.
  // During execution the live values are shown; on completion k6 has exited so
  // processCpuPct/processMemPct drop to 0 — use the run average instead.
  const isDone = status === 'complete' || status === 'stopped' || status === 'error';
  const k6CpuDisplay = React.useMemo(() => {
    const h = systemMetrics.history;
    if (!isDone || h.length === 0) return systemMetrics.processCpuPct;
    return h.reduce((s, p) => s + p.procCpu, 0) / h.length;
  }, [isDone, systemMetrics.history, systemMetrics.processCpuPct]);
  const k6MemDisplay = React.useMemo(() => {
    const h = systemMetrics.history;
    if (!isDone || h.length === 0) return systemMetrics.processMemPct;
    return h.reduce((s, p) => s + p.procMem, 0) / h.length;
  }, [isDone, systemMetrics.history, systemMetrics.processMemPct]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center">
            <Terminal size={18} className="text-brand-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">K6 Executor</h1>
            <p className="text-xs text-gray-500">Execute K6 scripts on this machine</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold text-white ${statusCfg.color}`}>
            {statusCfg.icon}
            {statusCfg.label}
            {liveMetrics.progress > 0 && isExecuting && <span className="ml-1 opacity-80">{liveMetrics.progress}%</span>}
            {isExecuting && autoFixMaxAttempts > 1 && (
              <span className="ml-1 opacity-80">· auto-fix attempt {autoFixAttempt}/{autoFixMaxAttempts}</span>
            )}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 select-none" title="On failure, ask Claude to diagnose and rewrite the script, then re-run — repeating until it passes or the attempt limit is reached.">
            <input
              type="checkbox"
              checked={autoFix}
              disabled={isExecuting}
              onChange={e => setAutoFix(e.target.checked)}
              className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            Auto-fix &amp; retry
            {autoFix && (
              <input
                type="number"
                min={2}
                max={5}
                value={autoFixMaxAttemptsInput}
                disabled={isExecuting}
                onChange={e => setAutoFixMaxAttemptsInput(Math.min(Math.max(parseInt(e.target.value, 10) || 3, 2), 5))}
                className="w-12 px-1.5 py-0.5 border border-gray-300 rounded text-xs text-gray-900"
                title="Max attempts"
              />
            )}
          </label>
          <button type="button" onClick={handleExecute} disabled={isExecuting || !getActiveScript().trim()}
            title={!getActiveScript().trim() ? 'Load a script before executing' : undefined}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-semibold text-white transition-colors shadow-sm">
            {isExecuting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {isExecuting ? 'Running...' : 'Execute'}
          </button>
          <button type="button" onClick={handleStop} disabled={!isExecuting}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-white hover:bg-red-50 border border-gray-200 hover:border-red-300 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-sm font-semibold text-gray-700 hover:text-red-600 transition-colors">
            <Square size={14} /> Stop
          </button>
        </div>
      </div>

      {/* Config: Test Name + Script Source, compact horizontal card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4 grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
        <div>
          <label className={labelCls}>Test Name</label>
          <input
            type="text"
            value={testName}
            onChange={e => setTestName(e.target.value)}
            placeholder="e.g. Search API Load Test"
            className={inputCls}
          />
        </div>

        <div>
          <p className={labelCls}>Script Source</p>
          <div className="flex items-center gap-4 mb-2">
            {(['authoring', 'upload', 'paste'] as ScriptSource[]).map(src => (
              <label key={src} className="flex items-center gap-1.5 cursor-pointer text-sm whitespace-nowrap">
                <input type="radio" name="scriptSource" value={src} checked={scriptSource === src}
                  onChange={() => setScriptSource(src)} className="accent-brand-500" />
                <span className="text-gray-700">
                  {src === 'authoring' ? 'From Test Authoring' : src === 'upload' ? 'Upload .js File' : 'Paste Script'}
                </span>
              </label>
            ))}
          </div>

          {scriptSource === 'authoring' && (
            authoringScript ? (
              <div className="flex items-center gap-2">
                <span className="bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 text-xs text-green-700">
                  ✓ Script loaded ({authoringScript.split('\n').length} lines)
                </span>
                {generatedScriptMeta && (
                  <span className="bg-purple-50 border border-purple-200 rounded-lg px-3 py-1.5 text-xs text-purple-700">
                    ✨ AI-generated · {generatedScriptMeta.source}
                  </span>
                )}
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-xs text-amber-700">
                No script found. Generate one in{' '}
                <button type="button" className="underline hover:text-amber-900" onClick={() => navigate('/tests/new')}>
                  Test Authoring
                </button>.
              </div>
            )
          )}

          {scriptSource === 'upload' && (
            <div {...getJsRootProps()} className={`border-2 border-dashed rounded-lg px-4 py-2 text-center cursor-pointer text-xs transition-colors ${isJsDragActive ? 'border-brand-500 bg-brand-50' : 'border-gray-300 hover:border-brand-400 hover:bg-gray-50'}`}>
              <input {...getJsInputProps()} />
              {uploadedScript
                ? <span className="text-green-600">✓ {uploadedScript.split('\n').length} lines loaded</span>
                : <span className="text-gray-500">Drop .js file or click to browse</span>}
            </div>
          )}

          {scriptSource === 'paste' && (
            <textarea
              className="w-full h-20 px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-mono text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              placeholder="Paste your K6 script here..."
              value={pastedScript}
              onChange={e => setPastedScript(e.target.value)}
            />
          )}
        </div>
      </div>

      {k6NotFound && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 mb-4">
          <AlertCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-700">K6 not found on this machine</p>
            <p className="text-sm text-red-600 mt-1">
              Install k6 to run scripts locally.{' '}
              <a href="https://k6.io/docs/get-started/installation/" target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-1">
                Installation guide <ExternalLink size={12} />
              </a>
            </p>
          </div>
        </div>
      )}

      {/* Live Metrics */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <BigMetricCard label="VUs"        value={String(liveMetrics.vus)}                                  sub="virtual users" />
        <BigMetricCard label="RPS"        value={liveMetrics.rps > 0 ? liveMetrics.rps.toFixed(1) : '—'} sub="req / sec" />
        <BigMetricCard label="P95 Latency" value={liveMetrics.p95 > 0 ? `${liveMetrics.p95.toFixed(0)}ms` : '—'} highlight={liveMetrics.p95 > 500} />
        <BigMetricCard label="Error Rate" value={liveMetrics.errorRate > 0 ? `${liveMetrics.errorRate.toFixed(2)}%` : '0%'} highlight={liveMetrics.errorRate > 1} />
      </div>

      {/* Response Time chart + System Resources side by side */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-2">Response Time (rolling 60s)</p>
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm" style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={liveMetrics.history} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="t" hide />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} unit="ms" />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }} labelStyle={{ display: 'none' }}
                  formatter={(val: any, name: string) => [`${Number(val).toFixed(1)}ms`, name]} />
                <ReferenceLine y={500} stroke="#d1d5db" strokeDasharray="4 4" label={{ value: 'threshold', fill: '#9ca3af', fontSize: 10 }} />
                <Line type="monotone" dataKey="p95" stroke="#ef4444" dot={false} strokeWidth={2} name="P95" isAnimationActive={false} />
                <Line type="monotone" dataKey="p50" stroke="#3b82f6" dot={false} strokeWidth={2} name="P50" isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-2">
            System Resources
            {isExecuting && (
              <span className="ml-2 inline-flex items-center gap-1 text-green-600 font-normal normal-case text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" /> live
              </span>
            )}
            {isDone && systemMetrics.history.length > 0 && (
              <span className="ml-2 text-gray-400 font-normal normal-case text-xs">k6 values show run average</span>
            )}
            {systemMetrics.totalMemMB > 0 && <span className="ml-2 text-gray-400 normal-case font-normal">{systemMetrics.freeMemMB}MB free / {systemMetrics.totalMemMB}MB total</span>}
          </p>
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm space-y-3" style={{ height: 200 }}>
            <ResourceBar label="CPU — System" pct={systemMetrics.systemCpuPct}  sub={isExecuting ? 'live' : isDone ? 'last' : ''} />
            <ResourceBar label="CPU — K6"     pct={k6CpuDisplay}                sub={isExecuting ? 'live' : isDone ? 'avg'  : ''} />
            <ResourceBar label="RAM — System" pct={systemMetrics.systemMemPct}  sub={isExecuting ? 'live' : isDone ? 'last' : ''} />
            <ResourceBar label="RAM — K6"     pct={k6MemDisplay}                sub={isExecuting ? 'live' : isDone ? 'avg'  : ''} />
          </div>
        </div>
      </div>

      {/* Console Output */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Console Output</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyLogs}
              disabled={consoleLines.length === 0}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded border border-gray-200 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Copy size={12} />
              {logsCopied ? 'Copied!' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={handleOpenRawLogs}
              disabled={consoleLines.length === 0}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded border border-gray-200 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileText size={12} />
              Open Raw Logs
            </button>
          </div>
        </div>
        <div ref={consoleBoxRef} className="bg-gray-900 rounded-lg p-4 font-mono text-xs h-64 overflow-y-auto border border-gray-200 shadow-sm">
          {consoleLines.length === 0
            ? <span className="text-gray-500">Waiting for execution to start...</span>
            : consoleLines.map(line => <div key={line.id} className={consoleLabelColor(line)}>{line.text}</div>)}
        </div>
      </div>

      {status === 'complete' && (
        <div className="mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-2">Execution Summary</p>
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: 'P50', val: summary?.p50 }, { label: 'P90', val: summary?.p90 },
              { label: 'P95', val: summary?.p95 }, { label: 'P99', val: summary?.p99 },
              { label: 'Error Rate', val: summary?.errorRate, isRate: true },
            ].map(({ label, val, isRate }) => (
              <div key={label} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
                <p className="text-xl font-bold text-gray-900 mt-1">
                  {val != null ? (isRate ? `${val.toFixed(2)}%` : `${val.toFixed(0)}ms`) : '—'}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 font-medium">✓ Execution completed successfully</div>

          {/* SLO Results */}
          {sloResults && sloResults.results.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-3">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">SLO / SLA Compliance</p>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${sloResults.overall === 'pass' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {sloResults.overall.toUpperCase()}
                </span>
              </div>
              <div className="space-y-2">
                {sloResults.results.map(r => {
                  const op = r.operator === 'lte' ? '≤' : '≥';
                  const metaLabel = SLO_METRIC_OPTIONS.find(o => o.value === r.metric)?.label ?? r.metric;
                  return (
                    <div key={r.id} className={`flex items-center justify-between rounded-lg px-3 py-2 border text-xs ${r.passed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                      <div>
                        <span className={`font-semibold mr-1 ${r.type === 'sla' ? 'text-orange-600' : 'text-purple-600'}`}>[{r.type.toUpperCase()}]</span>
                        <span className="text-gray-700">{r.label || metaLabel}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-500">
                          {r.actual != null ? `${r.actual}${r.unit}` : '?'} {op} {r.target}{r.unit}
                        </span>
                        <span className={r.passed ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
                          {r.passed ? '✓ PASS' : '✗ FAIL'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {status === 'error' && !k6NotFound && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          Execution ended with an error. Check the console output above.
        </div>
      )}

      {/* AI Troubleshooting */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={14} className="text-brand-600" />
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Troubleshoot with AI</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <p className="text-xs text-gray-500 mb-2">
            Describe what's going wrong, then ask Claude to diagnose it using the current script, console output
            {status === 'complete' ? ' and summary' : ''} from this execution.
          </p>
          <textarea
            className="w-full h-20 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            placeholder="e.g. Why is my error rate spiking after 2 minutes? Or paste the specific error you're seeing."
            value={troubleshootContext}
            onChange={e => setTroubleshootContext(e.target.value)}
            disabled={troubleshootStatus === 'loading'}
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-400">
              {consoleLines.length > 0 ? `${consoleLines.length} console lines will be sent as context` : 'No console output captured yet'}
            </span>
            <button
              type="button"
              onClick={handleTroubleshoot}
              disabled={troubleshootStatus === 'loading' || (!troubleshootContext.trim() && consoleLines.length === 0)}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-semibold text-white transition-colors shadow-sm"
            >
              {troubleshootStatus === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {troubleshootStatus === 'loading' ? 'Analyzing…' : 'Ask Claude'}
            </button>
          </div>

          {troubleshootStatus === 'error' && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {troubleshootError}
            </div>
          )}

          {(troubleshootAnswer || troubleshootStatus === 'loading') && troubleshootStatus !== 'error' && (
            <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
              {troubleshootAnswer || 'Thinking…'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
