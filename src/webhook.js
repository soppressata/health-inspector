import { createHash } from 'node:crypto';

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

export async function sendWebhook(url, payload, { headers = {}, secret, secretHeader = 'X-Health-Inspector-Secret', timeoutMs = 5000, retries = 3, fetchImpl = fetch } = {}) {
  const custom = validateHeaders(headers);
  if (secret !== undefined) { if (!secretHeader || /[\r\n]/.test(secretHeader)) throw new TypeError('invalid webhook secret header'); custom[secretHeader] = String(secret); }
  const delivery = payload.delivery_id || makeDeliveryId(payload);
  const attempts = Math.max(1, Number(retries) + 1);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    try {
      const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...custom, 'X-Health-Inspector-Delivery': delivery }, body: JSON.stringify(payload), signal: controller.signal });
      if (response.ok) return { delivered: true, attempts: attempt + 1, deliveryId: delivery };
      const retryable = TRANSIENT.has(response.status) || response.status >= 500;
      if (!retryable || attempt + 1 === attempts) return { delivered: false, attempts: attempt + 1, status: response.status, error: `HTTP ${response.status}` };
    } catch (error) {
      if (attempt + 1 === attempts) return { delivered: false, attempts: attempt + 1, error: redactSensitive(error.message) };
    } finally { clearTimeout(timer); }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000, 100 * 2 ** attempt)));
  }
  return { delivered: false, attempts };
}

export async function notifyWebhook(options) {
  if (!options || !options.url || !options.findings || options.findings.length === 0) return { delivered: false, skipped: true };
  const payload = buildWebhookPayload(options);
  return sendWebhook(options.url, payload, options);
}
