"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobHandler = void 0;
const k6Runner_1 = require("./k6Runner");
class JobHandler {
    constructor(connection) {
        this.connection = connection;
        this.activeJobs = new Map();
    }
    handle(message) {
        if (message.type === 'dispatch_job') {
            this.runJob(message).catch(err => {
                console.error(`[JobHandler] Unhandled error for ${message.executionId}:`, err.message);
            });
        }
        else if (message.type === 'cancel_job') {
            this.cancelJob(message.executionId);
        }
    }
    async runJob({ executionId, script, config }) {
        console.log(`[JobHandler] Starting job ${executionId}`);
        this.connection.send({ type: 'job_accepted', executionId });
        const runner = new k6Runner_1.K6Runner((update) => {
            if (update.type === 'complete') {
                this.connection.send({
                    type: 'job_complete',
                    executionId,
                    exitCode: update.data.exitCode,
                    summary: update.data.summary,
                });
                this.activeJobs.delete(executionId);
            }
            else if (update.type === 'error') {
                this.connection.send({ type: 'job_error', executionId, message: update.data.message });
                this.activeJobs.delete(executionId);
            }
            else {
                this.connection.send({ type: 'job_update', executionId, update });
            }
        });
        this.activeJobs.set(executionId, runner);
        try {
            await runner.run({ script, ...config });
        }
        catch (err) {
            this.connection.send({ type: 'job_error', executionId, message: err.message });
            this.activeJobs.delete(executionId);
        }
    }
    cancelJob(executionId) {
        const runner = this.activeJobs.get(executionId);
        if (runner) {
            console.log(`[JobHandler] Stopping job ${executionId}`);
            runner.stop();
        }
    }
}
exports.JobHandler = JobHandler;
