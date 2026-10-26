import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AdapterError,
  OndcAdapter,
  estimateMinutes,
  estimatePrice,
  parseGps,
  parseSearch,
  toIsoDuration,
} from '../src/services/ondcAdapter.js';

const config = {
  subscriberId: 'spoke-grid.test',
  bppUri: 'https://spoke-grid.test/ondc',
  domain: 'ONDC:LOG10',
  now: () => new Date('2026-01-15T10:00:00.000Z'),
};

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

const hasCode = (code) => (err) => err instanceof AdapterError && err.code === code;

test('parseGps reads "lat,lng" strings', () => {
  assert.deepEqual(parseGps(' 23.2 , 77.4 '), { lat: 23.2, lng: 77.4 });
});

test('parseGps rejects bad input', () => {
  for (const bad of ['abc', '91,10', '10,181', '12,', '1,2,3', 5, undefined]) {
    assert.throws(() => parseGps(bad), hasCode('INVALID_GPS'), `should reject ${String(bad)}`);
  }
});

test('parseSearch extracts both points and the ids', () => {
  const parsed = parseSearch(searchPayload);
  assert.deepEqual(parsed.pickup, { lat: 23.2, lng: 77.085 });
  assert.deepEqual(parsed.drop, { lat: 23.3315, lng: 75.0367 });
  assert.equal(parsed.transactionId, 'txn-1');
  assert.equal(parsed.messageId, 'msg-1');
});

test('parseSearch rejects other actions', () => {
  const wrong = { ...searchPayload, context: { ...searchPayload.context, action: 'select' } };
  assert.throws(() => parseSearch(wrong), hasCode('INVALID_ACTION'));
});

test('estimatePrice is a base fee plus a per-kilometre rate', () => {
  assert.equal(estimatePrice({ totalDistanceKm: 100 }), '380.00');
  assert.equal(estimatePrice({ totalDistanceKm: 0 }), '30.00');
});

test('estimateMinutes adds hub handling to travel time', () => {
  const sameHub = {
    originHubId: 'a',
    destinationHubId: 'a',
    legs: [
      { type: 'first_mile', distanceKm: 25 },
      { type: 'last_mile', distanceKm: 25 },
    ],
  };
  assert.equal(estimateMinutes(sameHub), 240);

  const crossHub = {
    originHubId: 'a',
    destinationHubId: 'b',
    legs: [
      { type: 'first_mile', distanceKm: 25 },
      { type: 'linehaul', distanceKm: 45 },
      { type: 'last_mile', distanceKm: 25 },
    ],
  };
  assert.equal(estimateMinutes(crossHub), 420);
  assert.equal(toIsoDuration(420), 'PT7H0M');
  assert.equal(toIsoDuration(95), 'PT1H35M');
});

test('buildOnSearch echoes ids and prices the route', () => {
  const adapter = new OndcAdapter(config);
  const route = {
    originHubId: 'hub-a',
    destinationHubId: 'hub-b',
    legs: [
      { type: 'first_mile', distanceKm: 25 },
      { type: 'linehaul', distanceKm: 45 },
      { type: 'last_mile', distanceKm: 25 },
    ],
    totalDistanceKm: 100,
  };
  const response = adapter.buildOnSearch(searchPayload, route);

  assert.equal(response.context.action, 'on_search');
  assert.equal(response.context.transaction_id, 'txn-1');
  assert.equal(response.context.message_id, 'msg-1');
  assert.equal(response.context.bap_id, 'buyer.test');
  assert.equal(response.context.bpp_id, 'spoke-grid.test');
  assert.equal(response.context.timestamp, '2026-01-15T10:00:00.000Z');

  const item = response.message.catalog['bpp/providers'][0].items[0];
  assert.deepEqual(item.price, { currency: 'INR', value: '380.00' });
  assert.equal(item.time.duration, 'PT7H0M');
});
