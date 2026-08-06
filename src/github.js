import { fingerprintFinding } from './state.js';

const API_BASE = 'https://api.github.com';

/**
 * Thin GitHub REST client implemented with plain fetch(). Produces the same
 * shape the rest of the code already expects:
 *   getContent({ owner, repo, path, ref }) -> { content, sha } or throws { status: 404 }
 *   createOrUpdateFile({ owner, repo, path, message, content, branch, sha }) -> raw body
 *   createIssue({ owner, repo, title, body, labels }) -> raw body ({ html_url, number, ... })
 * @param {string} token
 */
export function makeGithubClient(token) {
  const baseHeaders = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `token ${token}`,
  };

  async function request(method, urlPath, body) {
    const response = await fetch(`${API_BASE}${urlPath}`, {
      method,
      headers: {
        ...baseHeaders,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 300);
      } catch {
        // keep the empty detail
      }
      const err = new Error(`GitHub API HTTP ${response.status} ${detail}`);
      err.status = response.status;
      throw err;
    }

    if (response.status === 204) return null;
    return response.json();
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
    return { filed: false, reason: 'all findings already reported' };
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

  return { filed: true, issueUrl: issue.html_url, updatedState: state };
}
