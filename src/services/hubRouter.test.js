import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HubRouter, RoutingError, haversineKm } from '../src/services/hubRouter.js';

const hubs = [
  { id: 'hub-a', name: 'Hub A', lat: 23.26, lng: 77.41, capacity: 2 },
  { id: 'hub-b', name: 'Hub B', lat: 22.72, lng: 75.86, capacity: 2 },
];
const spokes = [{ id: 'spk-1', name: 'Spoke 1', lat: 23.2, lng: 77.085, hubId: 'hub-a' }];

const nearA = { lat: 23.2, lng: 77.1 };
const alsoNearA = { lat: 23.3, lng: 77.5 };
const nearB = { lat: 22.8, lng: 75.9 };

const hasCode = (code) => (err) => err instanceof RoutingError && err.code === code;

test('haversineKm is zero for identical points and plausible between cities', () => {
  assert.equal(haversineKm(hubs[0], hubs[0]), 0);
  const km = haversineKm(hubs[0], hubs[1]);
  assert.ok(km > 165 && km < 175, `expected about 170 km, got ${km}`);
});

test('routes within one hub area use two legs and no linehaul', () => {
  const router = new HubRouter({ hubs, spokes });
  const route = router.route({ pickup: nearA, drop: alsoNearA });
  assert.equal(route.originHubId, 'hub-a');
  assert.equal(route.destinationHubId, 'hub-a');
  assert.deepEqual(route.legs.map((leg) => leg.type), ['first_mile', 'last_mile']);
});

test('routes between hub areas add a linehaul leg', () => {
  const router = new HubRouter({ hubs, spokes });
  const route = router.route({ pickup: nearA, drop: nearB });
  assert.equal(route.originHubId, 'hub-a');
  assert.equal(route.destinationHubId, 'hub-b');
  assert.deepEqual(route.legs.map((leg) => leg.type), ['first_mile', 'linehaul', 'last_mile']);
  const linehaul = route.legs[1];
  assert.ok(linehaul.distanceKm > 165 && linehaul.distanceKm < 175);
  const sum = route.legs.reduce((total, leg) => total + leg.distanceKm, 0);
  assert.ok(Math.abs(route.totalDistanceKm - sum) < 0.15);
});

test('hubs marked down are skipped', () => {
  const router = new HubRouter({ hubs, spokes });
  router.setHubStatus('hub-a', 'down');
  const route = router.route({ pickup: nearA, drop: alsoNearA });
  assert.equal(route.originHubId, 'hub-b');
});

test('throws NO_HUB_IN_RANGE when every hub is too far away', () => {
  const router = new HubRouter({ hubs, spokes });
  assert.throws(
    () => router.route({ pickup: { lat: 28.61, lng: 77.21 }, drop: nearA }),
    hasCode('NO_HUB_IN_RANGE'),
  );
});

test('reserve adds one unit of load per distinct hub', () => {
  const router = new HubRouter({ hubs, spokes });
  router.route({ pickup: nearA, drop: alsoNearA }, { reserve: true });
  assert.equal(router.getHub('hub-a').load, 1);
  router.route({ pickup: nearA, drop: nearB }, { reserve: true });
  assert.equal(router.getHub('hub-a').load, 2);
  assert.equal(router.getHub('hub-b').load, 1);
});

test('a full hub is skipped until capacity is released', () => {
  const router = new HubRouter({ hubs: [{ ...hubs[0], capacity: 1 }], spokes });
  const first = router.route({ pickup: nearA, drop: alsoNearA }, { reserve: true });
  assert.throws(() => router.route({ pickup: nearA, drop: alsoNearA }), hasCode('NO_HUB_IN_RANGE'));

  router.release(first);
  assert.equal(router.getHub('hub-a').load, 0);
  assert.doesNotThrow(() => router.route({ pickup: nearA, drop: alsoNearA }));
});

test('points can be given as spoke ids', () => {
  const router = new HubRouter({ hubs, spokes });
  const route = router.route({ pickup: { spokeId: 'spk-1' }, drop: alsoNearA });
  assert.equal(route.originHubId, 'hub-a');
  assert.throws(
    () => router.route({ pickup: { spokeId: 'nope' }, drop: alsoNearA }),
    hasCode('UNKNOWN_SPOKE'),
  );
});

test('rejects malformed points', () => {
  const router = new HubRouter({ hubs, spokes });
  assert.throws(() => router.route({ pickup: { lat: '23.2', lng: 77.1 }, drop: nearA }), hasCode('INVALID_POINT'));
  assert.throws(() => router.route({ pickup: { lat: 95, lng: 10 }, drop: nearA }), hasCode('INVALID_POINT'));
  assert.throws(() => router.route({}), hasCode('INVALID_POINT'));
});
