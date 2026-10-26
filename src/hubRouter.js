const EARTH_RADIUS_KM = 6371;
const HUB_STATUSES = new Set(['up', 'down']);

export class RoutingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RoutingError';
    this.code = code;
  }
}

const toRad = (deg) => (deg * Math.PI) / 180;
const round1 = (n) => Math.round(n * 10) / 10;

export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function assertPoint(point, label) {
  const valid =
    point &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180;
  if (!valid) {
    throw new RoutingError(
      'INVALID_POINT',
      `${label} needs numeric lat (-90..90) and lng (-180..180), or a spokeId`,
    );
  }
}

export class HubRouter {
  constructor({ hubs = [], spokes = [], maxRadiusKm = 200 } = {}) {
    this.maxRadiusKm = maxRadiusKm;
    this.hubs = new Map(
      hubs.map((hub) => [
        hub.id,
        { ...hub, capacity: hub.capacity ?? 100, load: hub.load ?? 0, status: hub.status ?? 'up' },
      ]),
    );
    this.spokes = new Map(spokes.map((spoke) => [spoke.id, { ...spoke }]));
  }

  listHubs() {
    return [...this.hubs.values()].map((hub) => ({ ...hub }));
  }

  listSpokes() {
    return [...this.spokes.values()].map((spoke) => ({ ...spoke }));
  }

  getHub(id) {
    const hub = this.hubs.get(id);
    return hub ? { ...hub } : undefined;
  }

  setHubStatus(id, status) {
    const hub = this.hubs.get(id);
    if (!hub) throw new RoutingError('UNKNOWN_HUB', `Unknown hub: ${id}`);
    if (!HUB_STATUSES.has(status)) {
      throw new RoutingError('INVALID_STATUS', `Hub status must be one of: ${[...HUB_STATUSES].join(', ')}`);
    }
    hub.status = status;
  }

  resolvePoint(input, label) {
    if (input && typeof input.spokeId === 'string') {
      const spoke = this.spokes.get(input.spokeId);
      if (!spoke) throw new RoutingError('UNKNOWN_SPOKE', `Unknown spoke: ${input.spokeId}`);
      return { lat: spoke.lat, lng: spoke.lng };
    }
    assertPoint(input, label);
    return { lat: input.lat, lng: input.lng };
  }

  // Healthy hubs with spare capacity inside the radius, nearest first.
  nearestHubs(point, { limit = 3 } = {}) {
    return [...this.hubs.values()]
      .filter((hub) => hub.status === 'up' && hub.capacity - hub.load >= 1)
      .map((hub) => ({ hub, distanceKm: haversineKm(point, hub) }))
      .filter((candidate) => candidate.distanceKm <= this.maxRadiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);
  }

  route({ pickup, drop } = {}, { reserve = false } = {}) {
    const from = this.resolvePoint(pickup, 'pickup');
    const to = this.resolvePoint(drop, 'drop');

    const [origin] = this.nearestHubs(from, { limit: 1 });
    if (!origin) {
      throw new RoutingError('NO_HUB_IN_RANGE', 'No available hub within range of the pickup point');
    }
    const [destination] = this.nearestHubs(to, { limit: 1 });
    if (!destination) {
      throw new RoutingError('NO_HUB_IN_RANGE', 'No available hub within range of the drop point');
    }

    const legs = [
      { type: 'first_mile', from: 'pickup', to: origin.hub.id, distanceKm: round1(origin.distanceKm) },
    ];
    if (origin.hub.id !== destination.hub.id) {
      legs.push({
        type: 'linehaul',
        from: origin.hub.id,
        to: destination.hub.id,
        distanceKm: round1(haversineKm(origin.hub, destination.hub)),
      });
    }
    legs.push({
      type: 'last_mile',
      from: destination.hub.id,
      to: 'drop',
      distanceKm: round1(destination.distanceKm),
    });

    if (reserve) {
      for (const id of new Set([origin.hub.id, destination.hub.id])) {
        this.hubs.get(id).load += 1;
      }
    }

    return {
      originHubId: origin.hub.id,
      destinationHubId: destination.hub.id,
      legs,
      totalDistanceKm: round1(legs.reduce((sum, leg) => sum + leg.distanceKm, 0)),
      reserved: reserve,
    };
  }

  // Gives back the capacity held by a route created with reserve: true.
  release(route) {
    if (!route.reserved) return;
    for (const id of new Set([route.originHubId, route.destinationHubId])) {
      const hub = this.hubs.get(id);
      if (hub) hub.load = Math.max(0, hub.load - 1);
    }
  }
}
