import { Router, Request, Response } from 'express';

const router = Router();

const PROXY_PREFIX = '/api/grafana-proxy';

// Strip headers that block iframe embedding or cause proxy issues
const STRIP_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'transfer-encoding',
  'content-encoding', // we decode before forwarding
  'connection',
]);

async function proxyToGrafana(grafanaPath: string, req: Request, res: Response) {
  const grafanaUrl = process.env.GRAFANA_URL;
  if (!grafanaUrl) {
    res.status(503).send('GRAFANA_URL not configured');
    return;
  }

  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const targetUrl = `${grafanaUrl}${grafanaPath}${qs}`;

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}),
        Accept: (req.headers.accept as string) ?? '*/*',
        'Accept-Encoding': 'identity', // avoid compressed responses we can't rewrite
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    res.status(response.status);

    const contentType = response.headers.get('content-type') ?? '';

    response.headers.forEach((value, key) => {
      if (STRIP_HEADERS.has(key.toLowerCase())) return;
      res.setHeader(key, value);
    });

    const isHtml = contentType.includes('text/html');

    if (isHtml) {
      let body = await response.text();

      // Rewrite <base href> to point through our proxy so all relative
      // asset fetches (/public/build/..., /api/...) go via our server.
      const baseHref = `<base href="${PROXY_PREFIX}/">`;
      if (body.includes('<base ')) {
        body = body.replace(/<base [^>]*>/i, baseHref);
      } else if (body.includes('<head>')) {
        body = body.replace('<head>', `<head>${baseHref}`);
      } else if (body.includes('<HEAD>')) {
        body = body.replace('<HEAD>', `<HEAD>${baseHref}`);
      } else {
        body = baseHref + body;
      }

      res.send(body);
    } else {
      // Binary / JS / CSS — stream through as-is
      const buf = await response.arrayBuffer();
      res.end(Buffer.from(buf));
    }
  } catch (err: any) {
    res.status(502).send(`Cannot reach Grafana: ${err.message}`);
  }
}

// Entry point: /api/grafana-proxy?path=/d/UID&orgId=1&kiosk&refresh=10s
router.get('/grafana-proxy', (req: Request, res: Response) => {
  const grafanaPath = (req.query.path as string) || '/';
  // Rebuild query string without our own "path" param
  const params = new URLSearchParams(req.query as Record<string, string>);
  params.delete('path');
  const qs = params.toString();
  const fullPath = `${grafanaPath}${qs ? `?${qs}` : ''}`;
  proxyToGrafana(fullPath, req, res);
});

// Catch-all: /api/grafana-proxy/public/build/... → Grafana /public/build/...
// This lets the iframe load all JS/CSS/font assets through our server.
router.all('/grafana-proxy/*', (req: Request, res: Response) => {
  const subPath = req.path.replace(/^\/grafana-proxy/, '');
  proxyToGrafana(subPath, req, res);
});

export default router;
