import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { loadConfig } from '../src/config.js';
import { UptimeMonitor } from '../src/telemetry/uptimeMonitor.js';

let server;
let base;

const post = (path, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const searchPayload = {
  context: {
    domain: 'ONDC:LOG10',
    action: 'search',
    country: 'IND',
    city: 'std:0755',
    core_version: '1.2.0',
    bap_id: 'buyer.test',
    bap_uri: 'https://buyer.test/ondc',
    transaction_id: 'txn-1',
    message_id: 'msg-1',
    timestamp: '2026-01-15T09:59:59.000Z',
    ttl: 'PT30S',
  },
  message: {
    intent: {
      fulfillment: {
        start: { location: { gps: '23.2000,77.0850' } },
        end: { location: { gps: '23.3315,75.0367' } },
      },
    },
  },
};

before(async () => {
  const { app } = createApp({ config: loadConfig({}) });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(resolve));
});

test('GET /health reports status and version', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.version, '1.1.0');
});

test('GET /hubs and /spokes list the sample network', async () => {
  const hubs = await (await fetch(`${base}/hubs`)).json();
  const spokes = await (await fetch(`${base}/spokes`)).json();
  assert.equal(hubs.length, 4);
  assert.equal(spokes.length, 10);
});

test('POST /route links two spokes through two hubs', async () => {
  const res = await post('/route', {
    pickup: { spokeId: 'spk-sehore' },
    drop: { spokeId: 'spk-ratlam' },
  });
  assert.equal(res.status, 200);
  const route = await res.json();
  assert.equal(route.originHubId, 'hub-bpl');
  assert.equal(route.destinationHubId, 'hub-idr');
  assert.deepEqual(route.legs.map((leg) => leg.type), ['first_mile', 'linehaul', 'last_mile']);
});

test('POST /route with reserve increases hub load', async () => {
  const load = async () => (await (await fetch(`${base}/hubs`)).json()).find((h) => h.id === 'hub-gwl').load;
  const before = await load();
  const res = await post('/route', {
    pickup: { spokeId: 'spk-morena' },
    drop: { spokeId: 'spk-shivpuri' },
    reserve: true,
  });
  assert.equal(res.status, 200);
  assert.equal(await load(), before + 1);
});

test('POST /route validates input', async () => {
  const bad = await post('/route', { pickup: { lat: '23.2', lng: 77.1 }, drop: { spokeId: 'spk-sehore' } });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'INVALID_POINT');

  const far = await post('/route', { pickup: { lat: 28.61, lng: 77.21 }, drop: { spokeId: 'spk-sehore' } });
  assert.equal(far.status, 422);
  assert.equal((await far.json()).error.code, 'NO_HUB_IN_RANGE');

  const unknown = await post('/route', { pickup: { spokeId: 'spk-nowhere' }, drop: { spokeId: 'spk-sehore' } });
  assert.equal(unknown.status, 404);
});

test('POST /ondc/search answers with an on_search catalog', async () => {
  const res = await post('/ondc/search', searchPayload);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.context.action, 'on_search');
  assert.equal(body.context.transaction_id, 'txn-1');
  const item = body.message.catalog['bpp/providers'][0].items[0];
  assert.equal(item.price.currency, 'INR');
  assert.match(item.price.value, /^\d+\.\d{2}$/);
  assert.match(item.time.duration, /^PT\d+H\d+M$/);
});

test('POST /ondc/search NACKs a bad gps string', async () => {
  const broken = structuredClone(searchPayload);
  broken.message.intent.fulfillment.start.location.gps = 'not-a-location';
  const res = await post('/ondc/search', broken);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.message.ack.status, 'NACK');
  assert.equal(body.error.code, 'INVALID_GPS');
});

test('malformed JSON returns 400', async () => {
  const res = await fetch(`${base}/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'INVALID_JSON');
});

test('unknown paths return 404', async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
});

test('GET /telemetry lists every hub', async () => {
  const res = await fetch(`${base}/telemetry`);
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.equal(rows.length, 4);
  assert.equal(rows[0].uptimePct, null);
});

test('monitor marks a hub down after repeated failures and up again on success', () => {
  const { router, monitor } = createApp({ config: loadConfig({}) });
  monitor.record('hub-bpl', false);
  monitor.record('hub-bpl', false);
  assert.equal(router.getHub('hub-bpl').status, 'up');
  monitor.record('hub-bpl', false);
  assert.equal(router.getHub('hub-bpl').status, 'down');
  monitor.record('hub-bpl', true, 12);
  assert.equal(router.getHub('hub-bpl').status, 'up');

  const row = monitor.snapshot().find((entry) => entry.id === 'hub-bpl');
  assert.equal(row.uptimePct, 25);
  assert.equal(row.avgLatencyMs, 12);
});

test('checkAll records a failure for every hub when the probe throws', async () => {
  const { router } = createApp({ config: loadConfig({}) });
  const monitor = new UptimeMonitor({
    router,
    failureThreshold: 1,
    probe: async () => {
      throw new Error('unreachable');
    },
  });
  await monitor.checkAll();
  assert.ok(router.listHubs().every((hub) => hub.status === 'down'));
});
