import { AgentConnection } from './connection';
import { K6Runner, ExecutionUpdate } from './k6Runner';

export class JobHandler {
  private activeJobs = new Map<string, K6Runner>();

  constructor(private connection: AgentConnection) {}

  handle(message: any): void {
    if (message.type === 'dispatch_job') {
      this.runJob(message).catch(err => {
        console.error(`[JobHandler] Unhandled error for ${message.executionId}:`, err.message);
      });
    } else if (message.type === 'cancel_job') {
      this.cancelJob(message.executionId);
    }
  }

  private async runJob({ executionId, script, config }: any): Promise<void> {
    console.log(`[JobHandler] Starting job ${executionId}`);
    this.connection.send({ type: 'job_accepted', executionId });

    const runner = new K6Runner((update: ExecutionUpdate) => {
      if (update.type === 'complete') {
        const sum = update.data.summary;
        this.connection.send({
          type: 'job_complete',
          executionId,
          exitCode: update.data.exitCode,
          summary: sum,
          thresholdResults: sum?.thresholdResults ?? [],
          checkResults:     sum?.checkResults     ?? [],
        });
        this.activeJobs.delete(executionId);
      } else if (update.type === 'error') {
        this.connection.send({ type: 'job_error', executionId, message: update.data.message });
        this.activeJobs.delete(executionId);
      } else {
        this.connection.send({ type: 'job_update', executionId, update });
      }
    });

    this.activeJobs.set(executionId, runner);

    try {
      await runner.run({ script, ...config });
    } catch (err: any) {
      this.connection.send({ type: 'job_error', executionId, message: err.message });
      this.activeJobs.delete(executionId);
    }
  }

  private cancelJob(executionId: string): void {
    const runner = this.activeJobs.get(executionId);
    if (runner) {
      console.log(`[JobHandler] Stopping job ${executionId}`);
      runner.stop();
    }
  }
}
