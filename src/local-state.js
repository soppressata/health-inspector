import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

import { fingerprintFinding } from './state.js';
import { makeDeliveryId } from './webhook.js';

export const REPLAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const DEFAULT_LOCAL_STATE = {
  lastScannedRef: null,
  filedFingerprints: [],
  deliveries: [],
  rules: {},
};

export { fingerprintFinding };

function freshDefault() {
  return {
    lastScannedRef: null,
    filedFingerprints: [],
    deliveries: [],
    rules: {},
  };
}

function normalizeState(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const ref = parsed.lastScannedRef;
  return {
    lastScannedRef: ref === null || typeof ref === 'string' ? ref : null,
    filedFingerprints: Array.isArray(parsed.filedFingerprints)
      ? parsed.filedFingerprints.map((f) => String(f))
      : [],
    deliveries: Array.isArray(parsed.deliveries) ? parsed.deliveries : [],
    rules: parsed.rules && typeof parsed.rules === 'object' && !Array.isArray(parsed.rules)
      ? parsed.rules
      : {},
  };
}

export function loadLocalState(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const normalized = normalizeState(parsed);
    return normalized || freshDefault();
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err instanceof SyntaxError)) return freshDefault();
    throw err;
  }
}

export function saveLocalState(filePath, state) {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // directory may already exist
  }
  const tmp = `${resolved}.${randomBytes(6).toString('hex')}.tmp`;
  const data = JSON.stringify(state, null, 2);
  let fd;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, Buffer.from(data, 'utf8'));
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close errors
      }
    }
  }
  try {
    fs.renameSync(tmp, resolved);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore cleanup errors
    }
    throw err;
  }
  return state;
}

function payloadHash(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function deliveryIdFor(payload) {
  if (payload && typeof payload === 'object' && payload.delivery_id) {
    return payload.delivery_id;
  }
  return makeDeliveryId(payload);
}

export function recordDelivery(state, payload) {
  const id = deliveryIdFor(payload);
  const entry = { id, timestamp: Date.now(), payloadHash: payloadHash(payload) };
  return { ...state, deliveries: [...(state?.deliveries || []), entry] };
}

export function wasDelivered(state, payload, now = Date.now()) {
  const id = deliveryIdFor(payload);
  return Array.isArray(state?.deliveries) && state.deliveries.some(
    (d) => d && d.id === id && typeof d.timestamp === 'number' && now - d.timestamp <= REPLAY_WINDOW_MS,
  );
}
