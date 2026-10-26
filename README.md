# Spoke-Grid

Hub-and-spoke delivery routing for ONDC logistics networks.

Spoke-Grid takes a pickup point and a drop point, picks the nearest healthy hub with free capacity on each side, and returns the legs between them: first mile, linehaul and last mile. An adapter turns that route into an ONDC `on_search` catalog response with an INR price and a delivery time estimate. A small uptime monitor probes every hub and takes failing hubs out of rotation.

## Requirements

- Node.js 20 or newer

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

The server listens on `http://localhost:3000`. Try a route between two sample spokes:

```bash
curl -s localhost:3000/route \
  -H 'content-type: application/json' \
  -d '{"pickup":{"spokeId":"spk-sehore"},"drop":{"spokeId":"spk-ratlam"}}'
```

## API

| Method | Path            | Purpose                                                        |
| ------ | --------------- | -------------------------------------------------------------- |
| GET    | `/health`       | Service status, version and process uptime                     |
| GET    | `/hubs`         | All hubs with capacity, current load and status                |
| GET    | `/spokes`       | All spokes and their home hub                                  |
| GET    | `/telemetry`    | Uptime percentage and latency per hub                          |
| POST   | `/route`        | Route a parcel. Body: `pickup`, `drop`, optional `reserve`     |
| POST   | `/ondc/search`  | ONDC logistics `search`. Replies with an `on_search` payload   |

A point is either `{ "lat": 23.2, "lng": 77.08 }` or `{ "spokeId": "spk-sehore" }`. Set `"reserve": true` on `/route` to hold one unit of capacity on each hub the route touches.

Errors use `{ "error": { "code", "message" } }`. Routing errors map to `400` (`INVALID_POINT`), `404` (`UNKNOWN_SPOKE`) and `422` (`NO_HUB_IN_RANGE`). Malformed ONDC requests get a `NACK` with status `400`.

## Configuration

All settings are environment variables. See `.env.example` for the full list.

| Variable                   | Default                      | Meaning                                    |
| -------------------------- | ---------------------------- | ------------------------------------------ |
| `PORT`                     | `3000`                       | HTTP port                                  |
| `MAX_SPOKE_RADIUS_KM`      | `200`                        | Furthest a hub may be from a pickup or drop |
| `HUB_CAPACITY_DEFAULT`     | `120`                        | Capacity for hubs that do not set their own |
| `UPTIME_PROBE_INTERVAL_MS` | `30000`                      | Time between hub health probes             |
| `NODES_FILE`               | `data/sample_nodes.json`     | Hub and spoke definitions                  |
| `ONDC_SUBSCRIBER_ID`       | `spoke-grid.example.com`     | Subscriber id used as `bpp_id`             |
| `ONDC_BPP_URI`             | `http://localhost:3000/ondc` | Callback URI used as `bpp_uri`             |
| `ONDC_DOMAIN`              | `ONDC:LOG10`                 | ONDC domain code                           |

## Project layout

```
src/
  config.js                 environment and node file loading
  index.js                  Express app and HTTP entry point
  services/hubRouter.js     nearest-hub selection, legs, capacity
  services/ondcAdapter.js   ONDC search parsing, pricing, on_search
  telemetry/uptimeMonitor.js hub probes and failover
data/sample_nodes.json      sample hubs and spokes in central India
tests/                      node:test suites
docs/ARCHITECTURE.md        design notes
```

## Tests

```bash
npm test
```

The suites use the built-in `node:test` runner, so there is nothing extra to install.

## Hub health

Every hub is probed on an interval. If a hub has a `healthUrl`, the monitor calls it and expects a 2xx response. Hubs without one count as healthy. After three failures in a row a hub is marked `down` and the router skips it. The first successful probe brings it back.

## License

MIT
