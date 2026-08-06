import * as cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import prisma from '../lib/prisma';
import { dispatchJob } from './jobDispatcher';
import { notificationService } from './notificationService';
import { fetchScript as fetchScriptFromGithub } from './githubService';
import { fetchScript as fetchScriptFromGitlab } from './gitlabService';
import type { Schedule } from '@prisma/client';

const activeTasks = new Map<string, ReturnType<typeof cron.schedule>>();

function computeNextRun(cronExpression: string): Date | null {
  try {
    return CronExpressionParser.parse(cronExpression, { tz: 'UTC' }).next().toDate();
  } catch {
    return null;
  }
}

async function runSchedule(schedule: Schedule) {
  console.log(`[Scheduler] Triggering schedule "${schedule.name}" (${schedule.id})`);

  // Concurrency guard — if a run for this schedule is already in flight, skip this tick
  // (mirrors GitHub Actions' concurrency-group behavior instead of stacking runs).
  const inFlight = await prisma.execution.findFirst({
    where: { scheduleId: schedule.id, status: { in: ['queued', 'running'] } },
  });

  if (inFlight) {
    console.warn(`[Scheduler] Skipping "${schedule.name}" — previous run ${inFlight.id} still ${inFlight.status}`);
    await prisma.schedule.update({
      where: { id: schedule.id },
      data: { lastRunAt: new Date(), lastRunStatus: 'skipped', nextRunAt: computeNextRun(schedule.cronExpression) },
    });
    return null;
  }

  const spec = await prisma.testSpec.findUnique({ where: { id: schedule.specId } });
  if (!spec) {
    console.warn(`[Scheduler] Spec ${schedule.specId} not found for schedule ${schedule.id}`);
    await prisma.schedule.update({
      where: { id: schedule.id },
      data: { lastRunAt: new Date(), lastRunStatus: 'failed', nextRunAt: computeNextRun(schedule.cronExpression) },
    });
    return null;
  }

  let baseUrl = 'http://localhost:3000';
  let envName = 'local';

  if (schedule.environmentId) {
    const env = await prisma.environment.findUnique({ where: { id: schedule.environmentId } });
    if (env) { baseUrl = env.baseUrl; envName = env.name; }
  } else if ((spec as any).environmentId) {
    const env = await prisma.environment.findUnique({ where: { id: (spec as any).environmentId } });
    if (env) { baseUrl = env.baseUrl; envName = env.name; }
  }

  const execution = await prisma.execution.create({
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
      slos: (spec as any).slos ?? [],
    },
  });

  let lastRunStatus = 'dispatched';
  let finalExecution = execution;

  const dispatchConfig = {
    baseUrl,
    profileType: (spec.loadProfile as any)?.type || 'staged',
    stages: (spec.loadProfile as any)?.stages || [],
  };

  // When "Fetch script from repo on each run" is enabled, the script is
  // pulled fresh from the configured repo at run time instead of the
  // TestSpec's locally stored generatedScript, so the schedule always
  // executes whatever is currently committed. Uses the schedule's own repo
  // override if set (githubRepoUrl/branch/scriptPath/token, or the GitLab
  // equivalents), otherwise falls back to the GITHUB_*/GITLAB_* env vars.
  // When disabled, use the TestSpec's own generatedScript directly — this
  // was previously ignored entirely (the fetch always ran regardless of the
  // toggle), so a schedule with the toggle left off — the default — failed
  // outright unless the server happened to have GITHUB_TOKEN/OWNER/REPO env
  // vars configured as a silent fallback.
  // Fetch + dispatch happens off the scheduler's critical path — the cron
  // tick (and any triggerNow HTTP request) returns as soon as the Execution
  // row is queued, without waiting on the repo round-trip.
  const useGitlab = (schedule as any).scmProvider === 'gitlab';
  const fetchFromRepo = (schedule as any).fetchFromGithub === true;
  const scriptPromise: Promise<string> = fetchFromRepo
    ? (useGitlab
        ? fetchScriptFromGitlab(spec.name, {
            repoUrl: (schedule as any).gitlabRepoUrl,
            branch: (schedule as any).gitlabBranch,
            scriptPath: (schedule as any).gitlabScriptPath,
            token: (schedule as any).gitlabToken,
          })
        : fetchScriptFromGithub(spec.name, {
            repoUrl: (schedule as any).githubRepoUrl,
            branch: (schedule as any).githubBranch,
            scriptPath: (schedule as any).githubScriptPath,
            token: (schedule as any).githubToken,
          }))
    : spec.generatedScript
      ? Promise.resolve(spec.generatedScript)
      : Promise.reject(new Error(`Test spec "${spec.name}" has no generated script — author/generate a script for it, or enable "Fetch script from repo on each run" on this schedule.`));

  scriptPromise
    .then(script => dispatchJob(execution.id, script, dispatchConfig))
    .catch(async (err: any) => {
      console.warn(`[Scheduler] ${fetchFromRepo ? (useGitlab ? 'GitLab' : 'GitHub') : 'local'} fetch/dispatch failed for schedule ${schedule.id}: ${err.message}`);
      await prisma.execution.update({ where: { id: execution.id }, data: { status: 'fail', errorMessage: err.message } });
    });

  await prisma.schedule.update({
    where: { id: schedule.id },
    data: {
      lastRunAt: new Date(),
      lastRunStatus,
      nextRunAt: computeNextRun(schedule.cronExpression),
    },
  });

  // Dispatch notifications if configured
  const notifConfigs = notificationService.listConfigs();
  const targetConfig = schedule.notificationConfigId
    ? notifConfigs.find(c => c.id === schedule.notificationConfigId)
    : null;

  if (targetConfig) {
    // We'll dispatch after some delay to let execution settle — fire-and-forget
    setTimeout(async () => {
      const updated = await prisma.execution.findUnique({ where: { id: execution.id } });
      if (updated) {
        await notificationService.dispatch(targetConfig, {
          id: updated.id,
          specName: updated.specName,
          environment: updated.environment,
          status: updated.status,
          triggeredBy: updated.triggeredBy,
          completedAt: (updated as any).completedAt ?? undefined,
        });
      }
    }, 5 * 60 * 1000); // check after 5 min
  }

  return finalExecution;
}

function scheduleTask(schedule: Schedule) {
  if (!cron.validate(schedule.cronExpression)) {
    console.warn(`[Scheduler] Invalid cron expression for schedule "${schedule.name}": ${schedule.cronExpression}`);
    return;
  }

  if (activeTasks.has(schedule.id)) {
    activeTasks.get(schedule.id)!.stop();
    activeTasks.delete(schedule.id);
  }

  if (!schedule.enabled) return;

  const task = cron.schedule(schedule.cronExpression, () => runSchedule(schedule), {
    timezone: 'UTC',
  });

  activeTasks.set(schedule.id, task);
  console.log(`[Scheduler] Registered schedule "${schedule.name}" (${schedule.cronExpression})`);
}

export const schedulerService = {
  init: async () => {
    const schedules = await prisma.schedule.findMany();
    schedules.forEach(scheduleTask);
    console.log(`[Scheduler] Initialized ${schedules.length} schedules`);
  },

  listSchedules: () => prisma.schedule.findMany({ orderBy: { createdAt: 'desc' } }),

  createSchedule: async (data: {
    name: string;
    specId: string;
    environmentId: string | null;
    cronExpression: string;
    enabled: boolean;
    notificationConfigId: string | null;
    fetchFromGithub?: boolean;
    scmProvider?: string;
    githubRepoUrl?: string | null;
    githubBranch?: string | null;
    githubScriptPath?: string | null;
    githubToken?: string | null;
    gitlabRepoUrl?: string | null;
    gitlabBranch?: string | null;
    gitlabScriptPath?: string | null;
    gitlabToken?: string | null;
  }) => {
    const schedule = await prisma.schedule.create({
      data: { ...data, nextRunAt: data.enabled ? computeNextRun(data.cronExpression) : null },
    });
    scheduleTask(schedule);
    return schedule;
  },

  updateSchedule: async (id: string, updates: Partial<Schedule>) => {
    const existing = await prisma.schedule.findUnique({ where: { id } });
    if (!existing) return null;

    const merged = { ...existing, ...updates };
    const schedule = await prisma.schedule.update({
      where: { id },
      data: {
        ...updates,
        nextRunAt: merged.enabled ? computeNextRun(merged.cronExpression) : null,
      },
    });
    scheduleTask(schedule);
    return schedule;
  },

  deleteSchedule: async (id: string) => {
    try {
      await prisma.schedule.delete({ where: { id } });
    } catch {
      return false;
    }
    if (activeTasks.has(id)) {
      activeTasks.get(id)!.stop();
      activeTasks.delete(id);
    }
    return true;
  },

  triggerNow: async (id: string) => {
    const schedule = await prisma.schedule.findUnique({ where: { id } });
    if (!schedule) return { notFound: true as const };
    const execution = await runSchedule(schedule);
    if (!execution) return { skipped: true as const };
    return { execution };
  },

  listExecutions: (id: string) =>
    prisma.execution.findMany({
      where: { scheduleId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
};
