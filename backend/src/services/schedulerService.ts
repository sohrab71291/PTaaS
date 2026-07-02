import fs from 'fs';
import path from 'path';
import * as cron from 'node-cron';
import prisma from '../lib/prisma';
import { generateK6Script } from './k6Generator';
import { dispatchJob } from './jobDispatcher';
import { notificationService } from './notificationService';

const DATA_DIR = path.join(__dirname, '../../data');
const FILE = path.join(DATA_DIR, 'schedules.json');

export interface Schedule {
  id: string;
  name: string;
  specId: string;
  environmentId: string | null;
  cronExpression: string;
  enabled: boolean;
  notificationConfigId: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

const activeTasks = new Map<string, ReturnType<typeof cron.schedule>>();

function readSchedules(): Schedule[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeSchedules(data: Schedule[]): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

async function runSchedule(schedule: Schedule) {
  console.log(`[Scheduler] Triggering schedule "${schedule.name}" (${schedule.id})`);

  const spec = await prisma.testSpec.findUnique({ where: { id: schedule.specId } });
  if (!spec) {
    console.warn(`[Scheduler] Spec ${schedule.specId} not found for schedule ${schedule.id}`);
    return;
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
      thresholdBreaches: 0,
      checksPassed: 0,
      checksFailed: 0,
      thresholdResults: [],
      checkResults: [],
      responseTimeSeries: [],
      slos: (spec as any).slos ?? [],
    },
  });

  try {
    const script = generateK6Script(spec as any, baseUrl);
    await dispatchJob(execution.id, script, {
      baseUrl,
      profileType: (spec.loadProfile as any)?.type || 'staged',
      stages: (spec.loadProfile as any)?.stages || [],
    });
  } catch (err: any) {
    console.warn(`[Scheduler] Dispatch failed for schedule ${schedule.id}: ${err.message}`);
  }

  // Update lastRunAt
  const all = readSchedules();
  const idx = all.findIndex(s => s.id === schedule.id);
  if (idx !== -1) {
    all[idx].lastRunAt = new Date().toISOString();
    writeSchedules(all);
  }

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

  return execution;
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
  init: () => {
    const schedules = readSchedules();
    schedules.forEach(scheduleTask);
    console.log(`[Scheduler] Initialized ${schedules.length} schedules`);
  },

  listSchedules: () => readSchedules(),

  createSchedule: (schedule: Schedule) => {
    const all = readSchedules();
    all.push(schedule);
    writeSchedules(all);
    scheduleTask(schedule);
    return schedule;
  },

  updateSchedule: (id: string, updates: Partial<Schedule>) => {
    const all = readSchedules();
    const idx = all.findIndex(s => s.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...updates, id, updatedAt: new Date().toISOString() };
    writeSchedules(all);
    scheduleTask(all[idx]);
    return all[idx];
  },

  deleteSchedule: (id: string) => {
    const all = readSchedules();
    const next = all.filter(s => s.id !== id);
    if (next.length === all.length) return false;
    writeSchedules(next);
    if (activeTasks.has(id)) {
      activeTasks.get(id)!.stop();
      activeTasks.delete(id);
    }
    return true;
  },

  triggerNow: async (id: string) => {
    const schedule = readSchedules().find(s => s.id === id);
    if (!schedule) return null;
    return runSchedule(schedule);
  },
};
