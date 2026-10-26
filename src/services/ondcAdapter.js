export const BASE_FEE_INR = 30;
export const PER_KM_INR = 3.5;

const HANDLING_MINUTES_PER_HUB = 120;
const SPEED_KMH = { first_mile: 25, last_mile: 25, linehaul: 45 };

export class AdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
  }
}

// ONDC carries coordinates as a "lat,lng" string.
export function parseGps(gps) {
  if (typeof gps !== 'string') {
    throw new AdapterError('INVALID_GPS', 'gps must be a "lat,lng" string');
  }
  const parts = gps.split(',').map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => part === '')) {
    throw new AdapterError('INVALID_GPS', `gps must be a "lat,lng" string, got "${gps}"`);
  }
  const [lat, lng] = parts.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new AdapterError('INVALID_GPS', `gps is out of range: "${gps}"`);
  }
  return { lat, lng };
}

export function parseSearch(payload) {
  const context = payload?.context;
  if (context?.action !== 'search') {
    throw new AdapterError('INVALID_ACTION', 'context.action must be "search"');
  }
  const fulfillment = payload?.message?.intent?.fulfillment;
  return {
    pickup: parseGps(fulfillment?.start?.location?.gps),
    drop: parseGps(fulfillment?.end?.location?.gps),
    transactionId: context.transaction_id,
    messageId: context.message_id,
  };
}

export function estimatePrice(route) {
  return (BASE_FEE_INR + PER_KM_INR * route.totalDistanceKm).toFixed(2);
}

export function estimateMinutes(route) {
  const travel = route.legs.reduce(
    (sum, leg) => sum + (leg.distanceKm / (SPEED_KMH[leg.type] ?? 25)) * 60,
    0,
  );
  const hubsTouched = route.originHubId === route.destinationHubId ? 1 : 2;
  return Math.round(travel + hubsTouched * HANDLING_MINUTES_PER_HUB);
}

export function toIsoDuration(minutes) {
  return `PT${Math.floor(minutes / 60)}H${minutes % 60}M`;
}

export class OndcAdapter {
  constructor({ subscriberId, bppUri, domain = 'ONDC:LOG10', now = () => new Date() }) {
    this.subscriberId = subscriberId;
    this.bppUri = bppUri;
    this.domain = domain;
    this.now = now;
  }

  parseSearch(payload) {
    return parseSearch(payload);
  }

  buildContext(action, base = {}) {
    return {
      domain: this.domain,
      country: base.country ?? 'IND',
      city: base.city,
      action,
      core_version: base.core_version ?? '1.2.0',
      bap_id: base.bap_id,
      bap_uri: base.bap_uri,
      bpp_id: this.subscriberId,
      bpp_uri: this.bppUri,
      transaction_id: base.transaction_id,
      message_id: base.message_id,
      timestamp: this.now().toISOString(),
      ttl: 'PT30S',
    };
  }

  buildOnSearch(searchPayload, route) {
    return {
      context: this.buildContext('on_search', searchPayload.context),
      message: {
        catalog: {
          'bpp/descriptor': { name: 'Spoke-Grid Logistics' },
          'bpp/providers': [
            {
              id: this.subscriberId,
              descriptor: { name: 'Spoke-Grid Hub Network' },
              items: [
                {
                  id: 'standard-hub-spoke',
                  descriptor: { code: 'P2P', name: 'Hub-and-spoke standard delivery' },
                  price: { currency: 'INR', value: estimatePrice(route) },
                  time: { label: 'TAT', duration: toIsoDuration(estimateMinutes(route)) },
                },
              ],
            },
          ],
        },
      },
    };
  }
}
