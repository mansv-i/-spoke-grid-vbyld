import express from 'express';
import { pathToFileURL } from 'node:url';
import { loadConfig, loadNodes, version } from './config.js';
import { HubRouter, RoutingError } from './services/hubRouter.js';
import { OndcAdapter, AdapterError } from './services/ondcAdapter.js';
import { UptimeMonitor } from './telemetry/uptimeMonitor.js';

const STATUS_BY_ROUTING_CODE = {
  INVALID_POINT: 400,
  UNKNOWN_SPOKE: 404,
  NO_HUB_IN_RANGE: 422,
};

export function createApp(options = {}) {
  const config = options.config ?? loadConfig();
  const nodes = options.nodes ?? loadNodes(config);
  const router = options.router ?? new HubRouter({ ...nodes, maxRadiusKm: config.maxSpokeRadiusKm });
  const monitor = options.monitor ?? new UptimeMonitor({ router, intervalMs: config.probeIntervalMs });
  const adapter = options.adapter ?? new OndcAdapter(config.ondc);
  const startedAt = Date.now();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      version,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    });
  });

  app.get('/hubs', (req, res) => res.json(router.listHubs()));
  app.get('/spokes', (req, res) => res.json(router.listSpokes()));
  app.get('/telemetry', (req, res) => res.json(monitor.snapshot()));

  app.post('/route', (req, res) => {
    const { pickup, drop, reserve = false } = req.body ?? {};
    res.json(router.route({ pickup, drop }, { reserve: reserve === true }));
  });

  // Answers synchronously with the on_search payload. A production BPP would
  // reply with an ACK and POST the on_search to the buyer app's callback URI.
  app.post('/ondc/search', (req, res) => {
    const request = adapter.parseSearch(req.body);
    const route = router.route({ pickup: request.pickup, drop: request.drop });
    res.json(adapter.buildOnSearch(req.body, route));
  });

  app.use((req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof RoutingError) {
      return res
        .status(STATUS_BY_ROUTING_CODE[err.code] ?? 400)
        .json({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof AdapterError) {
      return res.status(400).json({
        message: { ack: { status: 'NACK' } },
        error: { type: 'JSON-SCHEMA-ERROR', code: err.code, message: err.message },
      });
    }
    if (err.type === 'entity.parse.failed') {
      return res
        .status(400)
        .json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
    }
    console.error(err);
    return res
      .status(500)
      .json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  return { app, router, monitor, adapter, config };
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const config = loadConfig();
  const { app, monitor } = createApp({ config });
  monitor.start();

  const server = app.listen(config.port, () => {
    console.log(`Spoke-Grid v${version} listening on port ${config.port}`);
  });

  const shutdown = () => {
    monitor.stop();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
