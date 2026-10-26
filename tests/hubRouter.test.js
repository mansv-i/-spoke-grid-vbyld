import test from 'node:test';
import assert from 'node:assert/strict';
import { HubRouter, haversineDistanceKm } from '../src/services/hubRouter.js';

const mockNodes = {
  hubs: [
    { id: 'hub-1', name: 'Hub 1', lat: 23.0, lng: 77.0, capacity: 10, currentLoad: 2, status: 'healthy' }
  ],
  spokes: [
    { id: 'spk-1', name: 'Spoke 1', homeHubId: 'hub-1', lat: 23.05, lng: 77.05 }
  ]
};

test('haversineDistanceKm returns accurate distance', () => {
  const dist = haversineDistanceKm(23.25, 77.41, 22.71, 75.85);
  assert.ok(dist > 170 && dist < 210);
});

test('HubRouter routes between valid spokes', () => {
  const router = new HubRouter(mockNodes);
  const route = router.calculateRoute({ spokeId: 'spk-1' }, { spokeId: 'spk-1' });
  assert.equal(route.hubs.origin, 'hub-1');
  assert.equal(route.hubs.destination, 'hub-1');
});
