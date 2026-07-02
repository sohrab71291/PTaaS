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
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const cron = __importStar(require("node-cron"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const k6Generator_1 = require("./k6Generator");
const jobDispatcher_1 = require("./jobDispatcher");
const notificationService_1 = require("./notificationService");
const DATA_DIR = path_1.default.join(__dirname, '../../data');
const FILE = path_1.default.join(DATA_DIR, 'schedules.json');
const activeTasks = new Map();
function readSchedules() {
    try {
        return JSON.parse(fs_1.default.readFileSync(FILE, 'utf-8'));
    }
    catch {
        return [];
    }
}
function writeSchedules(data) {
    if (!fs_1.default.existsSync(DATA_DIR))
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
    fs_1.default.writeFileSync(FILE, JSON.stringify(data, null, 2));
}
async function runSchedule(schedule) {
    console.log(`[Scheduler] Triggering schedule "${schedule.name}" (${schedule.id})`);
    const spec = await prisma_1.default.testSpec.findUnique({ where: { id: schedule.specId } });
    if (!spec) {
        console.warn(`[Scheduler] Spec ${schedule.specId} not found for schedule ${schedule.id}`);
        return;
    }
    const specRequest = spec.request;
    const specOrigin = (() => { try {
        return new URL(specRequest?.url).origin;
    }
    catch {
        return null;
    } })();
    let baseUrl = specOrigin ?? 'http://localhost:3000';
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
            thresholdBreaches: 0,
            checksPassed: 0,
            checksFailed: 0,
            thresholdResults: [],
            checkResults: [],
            responseTimeSeries: [],
            slos: spec.slos ?? [],
        },
    });
    try {
        const script = (0, k6Generator_1.generateK6Script)(spec, baseUrl);
        await (0, jobDispatcher_1.dispatchJob)(execution.id, script, {
            baseUrl,
            profileType: spec.loadProfile?.type || 'staged',
            stages: spec.loadProfile?.stages || [],
        });
    }
    catch (err) {
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
    return execution;
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
    init: () => {
        const schedules = readSchedules();
        schedules.forEach(scheduleTask);
        console.log(`[Scheduler] Initialized ${schedules.length} schedules`);
    },
    listSchedules: () => readSchedules(),
    createSchedule: (schedule) => {
        const all = readSchedules();
        all.push(schedule);
        writeSchedules(all);
        scheduleTask(schedule);
        return schedule;
    },
    updateSchedule: (id, updates) => {
        const all = readSchedules();
        const idx = all.findIndex(s => s.id === id);
        if (idx === -1)
            return null;
        all[idx] = { ...all[idx], ...updates, id, updatedAt: new Date().toISOString() };
        writeSchedules(all);
        scheduleTask(all[idx]);
        return all[idx];
    },
    deleteSchedule: (id) => {
        const all = readSchedules();
        const next = all.filter(s => s.id !== id);
        if (next.length === all.length)
            return false;
        writeSchedules(next);
        if (activeTasks.has(id)) {
            activeTasks.get(id).stop();
            activeTasks.delete(id);
        }
        return true;
    },
    triggerNow: async (id) => {
        const schedule = readSchedules().find(s => s.id === id);
        if (!schedule)
            return null;
        return runSchedule(schedule);
    },
};
