import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function positiveInt(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

export function loadConfig(env = process.env) {
  return {
    port: positiveInt(env, 'PORT', 3000),
    maxSpokeRadiusKm: positiveInt(env, 'MAX_SPOKE_RADIUS_KM', 200),
    defaultHubCapacity: positiveInt(env, 'HUB_CAPACITY_DEFAULT', 120),
    probeIntervalMs: positiveInt(env, 'UPTIME_PROBE_INTERVAL_MS', 30000),
    nodesFile: path.resolve(ROOT, env.NODES_FILE || 'data/sample_nodes.json'),
    ondc: {
      subscriberId: env.ONDC_SUBSCRIBER_ID || 'spoke-grid.example.com',
      bppUri: env.ONDC_BPP_URI || 'http://localhost:3000/ondc',
      domain: env.ONDC_DOMAIN || 'ONDC:LOG10',
    },
  };
}

export function loadNodes(config) {
  const raw = JSON.parse(readFileSync(config.nodesFile, 'utf8'));
  return {
    hubs: (raw.hubs ?? []).map((hub) => ({
      ...hub,
      capacity: hub.capacity ?? config.defaultHubCapacity,
    })),
    spokes: raw.spokes ?? [],
  };
}
