import { Router } from 'express';
import multer from 'multer';
import prisma from '../lib/prisma';
import { dispatchJob } from '../services/jobDispatcher';
import { agentRegistry } from '../services/agentRegistry';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/executor/run', upload.single('script'), async (req, res) => {
  try {
    const { vus, duration, stages, profileType, envVars, testName, slos } = req.body;
    let script: string;

    if (req.file) {
      script = req.file.buffer.toString('utf8');
    } else if (req.body.script) {
      script = req.body.script;
    } else {
      res.status(400).json({ error: 'No script provided' });
      return;
    }

    let parsedSlos: any[] = [];
    try { parsedSlos = slos ? (typeof slos === 'string' ? JSON.parse(slos) : slos) : []; } catch {}

    const execution = await prisma.execution.create({
      data: {
        specName: (typeof testName === 'string' && testName.trim()) ? testName.trim() : 'Ad-hoc Execution',
        environment: 'custom',
        status: 'queued',
        triggeredBy: (req as any).user?.email ?? 'executor',
        thresholdBreaches: 0,
        checksPassed: 0,
        checksFailed: 0,
        thresholdResults: [],
        checkResults: [],
        responseTimeSeries: [],
        slos: parsedSlos,
      },
    });

    const config = {
      vus: vus ? parseInt(vus) : 10,
      duration: duration || '1m',
      stages: stages ? (typeof stages === 'string' ? JSON.parse(stages) : stages) : null,
      profileType: profileType || 'staged',
      envVars: envVars ? (typeof envVars === 'string' ? JSON.parse(envVars) : envVars) : {},
    };

    try {
      await dispatchJob(execution.id, script, config);
    } catch (err: any) {
      return res.status(503).json({ error: err.message, executionId: execution.id });
    }

    res.json({ executionId: execution.id, wsUrl: `/ws/executor/${execution.id}` });
  } catch (err: any) {
    console.error('[executor/run] unhandled error:', err);
    res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
});

router.post('/executor/stop/:executionId', async (req, res) => {
  const exec = await prisma.execution.findUnique({ where: { id: req.params.executionId } });
  if (!exec || !exec.agentId) {
    res.status(404).json({ error: 'Execution not found or not running' });
    return;
  }
  const dispatched = agentRegistry.dispatch(exec.agentId, {
    type: 'cancel_job',
    executionId: exec.id,
  });
  res.json({ stopped: dispatched });
});

export default router;
