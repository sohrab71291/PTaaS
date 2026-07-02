import { Router, Request, Response } from 'express';
import { isQueryEnabled, queryDataPrime } from '../services/coralogix';

const router = Router();

router.get('/coralogix/status', (_req: Request, res: Response) => {
  res.json({
    ingestionConfigured: !!process.env.CORALOGIX_API_KEY,
    queryConfigured: isQueryEnabled(),
    domain: process.env.CORALOGIX_DOMAIN ?? 'eu2.coralogix.com',
    appName: process.env.CORALOGIX_APP_NAME ?? 'PTaaS',
  });
});

router.get('/coralogix/logs', async (req: Request, res: Response) => {
  try {
    const { rows, warnings } = await queryDataPrime('logs', {
      text: typeof req.query.q === 'string' ? req.query.q : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      lookbackMinutes: req.query.lookback ? Number(req.query.lookback) : undefined,
    });
    res.json({ rows, warnings });
  } catch (err: any) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/coralogix/traces', async (req: Request, res: Response) => {
  try {
    const { rows, warnings } = await queryDataPrime('spans', {
      text: typeof req.query.q === 'string' ? req.query.q : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      lookbackMinutes: req.query.lookback ? Number(req.query.lookback) : undefined,
    });
    res.json({ rows, warnings });
  } catch (err: any) {
    res.status(503).json({ error: err.message });
  }
});

export default router;
