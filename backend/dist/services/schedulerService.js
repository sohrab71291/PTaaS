"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.schedulerService = void 0;
const cron = __importStar(require("node-cron"));
const cron_parser_1 = require("cron-parser");
const prisma_1 = __importDefault(require("../lib/prisma"));
const jobDispatcher_1 = require("./jobDispatcher");
const notificationService_1 = require("./notificationService");
const githubService_1 = require("./githubService");
const gitlabService_1 = require("./gitlabService");
const activeTasks = new Map();
function computeNextRun(cronExpression) {
    try {
        return cron_parser_1.CronExpressionParser.parse(cronExpression, { tz: 'UTC' }).next().toDate();
    }
    catch {
        return null;
    }
}
async function runSchedule(schedule) {
    console.log(`[Scheduler] Triggering schedule "${schedule.name}" (${schedule.id})`);
    // Concurrency guard — if a run for this schedule is already in flight, skip this tick
    // (mirrors GitHub Actions' concurrency-group behavior instead of stacking runs).
    const inFlight = await prisma_1.default.execution.findFirst({
        where: { scheduleId: schedule.id, status: { in: ['queued', 'running'] } },
    });
    if (inFlight) {
        console.warn(`[Scheduler] Skipping "${schedule.name}" — previous run ${inFlight.id} still ${inFlight.status}`);
        await prisma_1.default.schedule.update({
            where: { id: schedule.id },
            data: { lastRunAt: new Date(), lastRunStatus: 'skipped', nextRunAt: computeNextRun(schedule.cronExpression) },
        });
        return null;
    }
    const spec = await prisma_1.default.testSpec.findUnique({ where: { id: schedule.specId } });
    if (!spec) {
        console.warn(`[Scheduler] Spec ${schedule.specId} not found for schedule ${schedule.id}`);
        await prisma_1.default.schedule.update({
            where: { id: schedule.id },
            data: { lastRunAt: new Date(), lastRunStatus: 'failed', nextRunAt: computeNextRun(schedule.cronExpression) },
        });
        return null;
    }
    let baseUrl = 'http://localhost:3000';
    let envName = 'local';
    if (schedule.environmentId) {
        const env = await prisma_1.default.environment.findUnique({ where: { id: schedule.environmentId } });
        if (env) {
            baseUrl = env.baseUrl;
            envName = env.name;
        }
    }
    else if (spec.environmentId) {
        const env = await prisma_1.default.environment.findUnique({ where: { id: spec.environmentId } });
        if (env) {
            baseUrl = env.baseUrl;
            envName = env.name;
        }
    }
    const execution = await prisma_1.default.execution.create({
        data: {
            specId: spec.id,
            specName: spec.name,
            environment: envName,
            status: 'queued',
            triggeredBy: `schedule:${schedule.name}`,
            scheduleId: schedule.id,
            thresholdBreaches: 0,
            checksPassed: 0,
            checksFailed: 0,
            thresholdResults: [],
            checkResults: [],
            responseTimeSeries: [],
            slos: spec.slos ?? [],
        },
    });
    let lastRunStatus = 'dispatched';
    let finalExecution = execution;
    const dispatchConfig = {
        baseUrl,
        profileType: spec.loadProfile?.type || 'staged',
        stages: spec.loadProfile?.stages || [],
    };
    // Scripts are always pulled fresh from the configured repo at run time —
    // never from the TestSpec's locally stored generatedScript — so a schedule
    // always executes whatever is currently committed. Uses the schedule's own
    // repo override if set (githubRepoUrl/branch/scriptPath/token, or the
    // GitLab equivalents), otherwise falls back to the GITHUB_*/GITLAB_* env vars.
    // Fetch + dispatch happens off the scheduler's critical path — the cron
    // tick (and any triggerNow HTTP request) returns as soon as the Execution
    // row is queued, without waiting on the repo round-trip.
    const useGitlab = schedule.scmProvider === 'gitlab';
    const fetchPromise = useGitlab
        ? (0, gitlabService_1.fetchScript)(spec.name, {
            repoUrl: schedule.gitlabRepoUrl,
            branch: schedule.gitlabBranch,
            scriptPath: schedule.gitlabScriptPath,
            token: schedule.gitlabToken,
        })
        : (0, githubService_1.fetchScript)(spec.name, {
            repoUrl: schedule.githubRepoUrl,
            branch: schedule.githubBranch,
            scriptPath: schedule.githubScriptPath,
            token: schedule.githubToken,
        });
    fetchPromise
        .then(script => (0, jobDispatcher_1.dispatchJob)(execution.id, script, dispatchConfig))
        .catch(async (err) => {
        console.warn(`[Scheduler] ${useGitlab ? 'GitLab' : 'GitHub'} fetch/dispatch failed for schedule ${schedule.id}: ${err.message}`);
        await prisma_1.default.execution.update({ where: { id: execution.id }, data: { status: 'fail', errorMessage: err.message } });
    });
    await prisma_1.default.schedule.update({
        where: { id: schedule.id },
        data: {
            lastRunAt: new Date(),
            lastRunStatus,
            nextRunAt: computeNextRun(schedule.cronExpression),
        },
    });
    // Dispatch notifications if configured
    const notifConfigs = notificationService_1.notificationService.listConfigs();
    const targetConfig = schedule.notificationConfigId
        ? notifConfigs.find(c => c.id === schedule.notificationConfigId)
        : null;
    if (targetConfig) {
        // We'll dispatch after some delay to let execution settle — fire-and-forget
        setTimeout(async () => {
            const updated = await prisma_1.default.execution.findUnique({ where: { id: execution.id } });
            if (updated) {
                await notificationService_1.notificationService.dispatch(targetConfig, {
                    id: updated.id,
                    specName: updated.specName,
                    environment: updated.environment,
                    status: updated.status,
                    triggeredBy: updated.triggeredBy,
                    completedAt: updated.completedAt ?? undefined,
                });
            }
        }, 5 * 60 * 1000); // check after 5 min
    }
    return finalExecution;
}
function scheduleTask(schedule) {
    if (!cron.validate(schedule.cronExpression)) {
        console.warn(`[Scheduler] Invalid cron expression for schedule "${schedule.name}": ${schedule.cronExpression}`);
        return;
    }
    if (activeTasks.has(schedule.id)) {
        activeTasks.get(schedule.id).stop();
        activeTasks.delete(schedule.id);
    }
    if (!schedule.enabled)
        return;
    const task = cron.schedule(schedule.cronExpression, () => runSchedule(schedule), {
        timezone: 'UTC',
    });
    activeTasks.set(schedule.id, task);
    console.log(`[Scheduler] Registered schedule "${schedule.name}" (${schedule.cronExpression})`);
}
exports.schedulerService = {
    init: async () => {
        const schedules = await prisma_1.default.schedule.findMany();
        schedules.forEach(scheduleTask);
        console.log(`[Scheduler] Initialized ${schedules.length} schedules`);
    },
    listSchedules: () => prisma_1.default.schedule.findMany({ orderBy: { createdAt: 'desc' } }),
    createSchedule: async (data) => {
        const schedule = await prisma_1.default.schedule.create({
            data: { ...data, nextRunAt: data.enabled ? computeNextRun(data.cronExpression) : null },
        });
        scheduleTask(schedule);
        return schedule;
    },
    updateSchedule: async (id, updates) => {
        const existing = await prisma_1.default.schedule.findUnique({ where: { id } });
        if (!existing)
            return null;
        const merged = { ...existing, ...updates };
        const schedule = await prisma_1.default.schedule.update({
            where: { id },
            data: {
                ...updates,
                nextRunAt: merged.enabled ? computeNextRun(merged.cronExpression) : null,
            },
        });
        scheduleTask(schedule);
        return schedule;
    },
    deleteSchedule: async (id) => {
        try {
            await prisma_1.default.schedule.delete({ where: { id } });
        }
        catch {
            return false;
        }
        if (activeTasks.has(id)) {
            activeTasks.get(id).stop();
            activeTasks.delete(id);
        }
        return true;
    },
    triggerNow: async (id) => {
        const schedule = await prisma_1.default.schedule.findUnique({ where: { id } });
        if (!schedule)
            return { notFound: true };
        const execution = await runSchedule(schedule);
        if (!execution)
            return { skipped: true };
        return { execution };
    },
    listExecutions: (id) => prisma_1.default.execution.findMany({
        where: { scheduleId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
    }),
};
