import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { recordDelivery, wasDelivered } from './local-state.js';

const TRANSIENT = new Set([408, 425, 429]);

export function validateHeaders(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('webhook headers must be an object');
  const headers = {};
  for (const [name, value] of Object.entries(input)) {
    if (!name || /[\r\n]/.test(name) || /^(host|content-length|content-type)$/i.test(name) || typeof value !== 'string' || /[\r\n]/.test(value)) {
      throw new TypeError(`invalid webhook header: ${name}`);
    }
    headers[name] = value;
  }
  return headers;
}

export function redactSensitive(value) {
  return String(value ?? '').replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED]').replace(/(["']?(?:api[_-]?key|secret|password)["']?\s*[:=]\s*["'])[^"']+/gi, '$1[REDACTED]');
}

export function makeDeliveryId({ repository = '', ref = '', findings = [] } = {}) {
  return createHash('sha256').update(`${repository}\0${ref}\0${findings.map((f) => `${f.file}:${f.line}:${f.type}`).join('\0')}`).digest('hex').slice(0, 32);
}

export function buildWebhookPayload({ repository, ref, findings = [], reportUrl = null, deliveryId } = {}) {
  return {
    schema_version: 1, event: 'health-inspector.findings', delivery_id: deliveryId || makeDeliveryId({ repository, ref, findings }),
    repository: repository || null, ref: ref || null, findings_count: findings.length,
    findings: findings.map(({ type, file, line, severity, reason }) => ({ type, file, line, severity, reason })), report_url: reportUrl,
  };
}

export function signPayload(payload, secret) {
  return createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

export function verifySignature(payload, secret, signature) {
  if (typeof signature !== 'string') return false;
  let hex = signature;
  if (hex.startsWith('sha256=')) hex = hex.slice(7);
  if (!hex || !/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return false;
  const expected = signPayload(payload, secret);
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(hex, 'hex');
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export async function sendWebhook(url, payload, {
  headers = {}, secret, secretHeader = 'X-Health-Inspector-Secret', timeoutMs = 5000,
  retries = 3, fetchImpl = fetch, signingSecret, signatureHeader = 'X-Health-Inspector-Signature',
  state, outboxDir, drainPrevious = false,
} = {}) {
  const custom = validateHeaders(headers);
  if (secret !== undefined) { if (!secretHeader || /[\r\n]/.test(secretHeader)) throw new TypeError('invalid webhook secret header'); custom[secretHeader] = String(secret); }
  const delivery = payload.delivery_id || makeDeliveryId(payload);
  if (signingSecret !== undefined) {
    if (!signatureHeader || /[\r\n]/.test(signatureHeader)) throw new TypeError('invalid webhook signature header');
    custom[signatureHeader] = `sha256=${signPayload(payload, signingSecret)}`;
  }
  if (state !== undefined && state !== null) {
    if (wasDelivered(state, payload)) {
      return { delivered: false, skipped: true, reason: 'replay', deliveryId: delivery };
    }
  }
  if (drainPrevious && outboxDir) {
    const outgoingOptions = { url, headers, secret, secretHeader, timeoutMs, retries, fetchImpl, signingSecret, signatureHeader, state };
    await drainOutbox(outboxDir, outgoingOptions);
  }
  const attempts = Math.max(1, Number(retries) + 1);
  let result;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    try {
      const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...custom, 'X-Health-Inspector-Delivery': delivery }, body: JSON.stringify(payload), signal: controller.signal });
      if (response.ok) { result = { delivered: true, attempts: attempt + 1, deliveryId: delivery }; break; }
      const retryable = TRANSIENT.has(response.status) || response.status >= 500;
      if (!retryable || attempt + 1 === attempts) { result = { delivered: false, attempts: attempt + 1, status: response.status, error: `HTTP ${response.status}` }; break; }
    } catch (error) {
      if (attempt + 1 === attempts) { result = { delivered: false, attempts: attempt + 1, error: redactSensitive(error.message) }; break; }
    } finally { clearTimeout(timer); }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000, 100 * 2 ** attempt)));
  }
  if (!result) result = { delivered: false, attempts };
  if (result.delivered) {
    if (state !== undefined && state !== null) {
      return { ...result, updatedState: recordDelivery(state, payload) };
    }
    return result;
  }
  if (outboxDir) {
    fs.mkdirSync(outboxDir, { recursive: true });
    fs.writeFileSync(path.join(outboxDir, `${delivery}.json`), JSON.stringify(payload), 'utf8');
  }
  return result;
}

export async function drainOutbox(outboxDir, sendOpts = {}) {
  if (!fs.existsSync(outboxDir)) return { delivered: 0, failed: 0, remaining: 0 };
  const { url, ...rest } = sendOpts;
  const files = fs.readdirSync(outboxDir).filter((f) => f.endsWith('.json'));
  let delivered = 0;
  let failed = 0;
  for (const file of files) {
    const fullPath = path.join(outboxDir, file);
    const payload = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    const result = await sendWebhook(url, payload, { ...rest, outboxDir: undefined, drainPrevious: false });
    if (result.delivered) {
      fs.unlinkSync(fullPath);
      delivered += 1;
    } else if (result.skipped) {
      fs.unlinkSync(fullPath);
    } else {
      failed += 1;
    }
  }
  const remaining = fs.existsSync(outboxDir) ? fs.readdirSync(outboxDir).filter((f) => f.endsWith('.json')).length : 0;
  return { delivered, failed, remaining };
}

export async function notifyWebhook(options) {
  if (!options || !options.url || !options.findings || options.findings.length === 0) return { delivered: false, skipped: true };
  const payload = buildWebhookPayload(options);
  return sendWebhook(options.url, payload, options);
}
