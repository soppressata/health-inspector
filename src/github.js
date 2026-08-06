import { fingerprintFinding } from './state.js';

const API_BASE = 'https://api.github.com';

/**
 * Classify an HTTP status as retryable.
 * Retryable: 408, 425, 429, and any 5xx (500-599).
 * Everything else is considered permanent.
 * @param {number} status
 * @returns {boolean}
 */
export function isRetryable(status) {
  if (status === 408 || status === 425 || status === 429) return true;
  return status >= 500 && status <= 599;
}

/**
 * Thin GitHub REST client implemented with plain fetch(). Produces the same
 * shape the rest of the code already expects:
 *   getContent({ owner, repo, path, ref }) -> { content, sha } or throws { status: 404 }
 *   createOrUpdateFile({ owner, repo, path, message, content, branch, sha }) -> raw body
 *   createIssue({ owner, repo, title, body, labels }) -> raw body ({ html_url, number, ... })
 * @param {string} token
 * @param {object} [options]
 * @param {number} [options.timeoutMs=10000] per-request abort timeout
 * @param {number} [options.maxRetries=3] number of retry attempts for retryable failures
 * @param {number} [options.retryBaseMs=200] base for exponential backoff
 * @param {Function} [options.fetchImpl=fetch] injectable fetch for tests
 */
export function makeGithubClient(token, options = {}) {
  const {
    timeoutMs = 10000,
    maxRetries = 3,
    retryBaseMs = 200,
    fetchImpl = fetch,
  } = options;

  const baseHeaders = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `token ${token}`,
  };

  async function request(method, urlPath, body) {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(`${API_BASE}${urlPath}`, {
          method,
          headers: {
            ...baseHeaders,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        // Network error (incl. abort from timeout): retry if attempts remain, else throw
        if (attempt < maxRetries) {
          lastErr = err;
          const backoff = Math.min(retryBaseMs * 2 ** attempt, 5000);
          await delay(backoff);
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }

      // A response was received — classify by status.
      if (response.ok) {
        if (response.status === 204) return null;
        return response.json();
      }

      const err = await buildApiError(response);
      if (isRetryable(response.status) && attempt < maxRetries) {
        lastErr = err;
        const backoff = Math.min(retryBaseMs * 2 ** attempt, 5000);
        await delay(backoff);
        continue;
      }
      // Permanent error (or out of retries): throw immediately, do not retry.
      throw err;
    }
    throw lastErr;
  }

  async function buildApiError(response) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      // keep the empty detail
    }
    const err = new Error(`GitHub API HTTP ${response.status} ${detail}`);
    err.status = response.status;
    return err;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return {
    getContent: async ({ owner, repo, path, ref }) => {
      const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      return request('GET', `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}${query}`);
    },
    createOrUpdateFile: async ({ owner, repo, path, ...payload }) => {
      return request('PUT', `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, payload);
    },
    createIssue: async ({ owner, repo, ...payload }) => {
      return request('POST', `/repos/${owner}/${repo}/issues`, payload);
    },
    getRef: async ({ owner, repo, ref }) => {
      return request('GET', `/repos/${owner}/${repo}/git/ref/${ref}`);
    },
    createRef: async ({ owner, repo, ...payload }) => {
      return request('POST', `/repos/${owner}/${repo}/git/refs`, payload);
    },
    getRepo: async ({ owner, repo }) => {
      return request('GET', `/repos/${owner}/${repo}`);
    },
  };
}

/**
 * @param {object} args
 * @param {{createIssue: Function}} args.octokitLike thin client, createIssue resolves to
 *   the raw REST body ({ html_url, number, ... })
 */
export async function fileReport({ octokitLike, owner, repo, label, reportMarkdown, findings, state }) {
  const list = Array.isArray(findings) ? findings : [];
  const alreadyFiled = new Set(state.filedFingerprints);
  const newFindings = list.filter((f) => !alreadyFiled.has(fingerprintFinding(f)));

  if (newFindings.length === 0) {
    return { filed: false, reason: 'all findings already reported', newFindings, updatedState: state };
  }

  const issue = await octokitLike.createIssue({
    owner,
    repo,
    title: `[Health Inspector] ${newFindings.length} new finding(s)`,
    body: reportMarkdown,
    labels: [label],
  });

  for (const f of newFindings) {
    const fp = fingerprintFinding(f);
    if (!state.filedFingerprints.includes(fp)) state.filedFingerprints.push(fp);
  }

  return { filed: true, issueUrl: issue.html_url, newFindings, updatedState: state };
}
