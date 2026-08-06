import { createHash } from 'node:crypto';

const STATE_FILE = 'state.json';

export const DEFAULT_STATE = { lastScannedRef: null, filedFingerprints: [] };

/**
 * @param {{file?: string, type?: string, snippet?: string}} finding
 * @returns {string} stable 12-hex fingerprint
 */
export function fingerprintFinding(finding) {
  const file = String((finding && finding.file) || '');
  const type = String((finding && finding.type) || '');
  const snippet = String((finding && finding.snippet) || '');
  const normalized = snippet.replace(/\s+/g, ' ').trim();
  const digest = createHash('sha1')
    .update(`${file}\u0000${type}\u0000${normalized}`)
    .digest('hex');
  return digest.slice(0, 12);
}

function decodeContent(encoded) {
  const json = Buffer.from(encoded.replace(/\s+/g, ''), 'base64').toString('utf8');
  const parsed = JSON.parse(json);
  return {
    lastScannedRef: typeof parsed.lastScannedRef === 'string' ? parsed.lastScannedRef : null,
    filedFingerprints: Array.isArray(parsed.filedFingerprints) ? parsed.filedFingerprints : [],
  };
}

/**
 * @param {object} args
 * @param {{getContent: Function}} args.octokitLike thin client, getContent resolves to
 *   the raw REST body ({ content, sha }) or rejects with { status: 404 }
 */
export async function loadState({ octokitLike, owner, repo, stateBranch }) {
  try {
    const { content } = await octokitLike.getContent({
      owner,
      repo,
      path: STATE_FILE,
      ref: stateBranch,
    });
    return decodeContent(content);
  } catch (err) {
    if (err && err.status === 404) return { ...DEFAULT_STATE };
    throw err;
  }
}

/**
 * The Contents API rejects writes to a branch that doesn't exist yet (it does not
 * create branches implicitly) - so on first use, health-inspector-state has to be
 * created explicitly from the default branch's current commit before we can write
 * state.json to it. `getRef`/`createRef` are optional on octokitLike: clients that
 * don't provide them (e.g. simple in-memory test doubles) just skip this step.
 * @param {{getRef?: Function, createRef?: Function, getRepo?: Function}} octokitLike
 */
async function ensureBranchExists({ octokitLike, owner, repo, branch }) {
  if (!octokitLike.getRef || !octokitLike.createRef) return;
  try {
    await octokitLike.getRef({ owner, repo, ref: `heads/${branch}` });
    return;
  } catch (err) {
    if (!err || err.status !== 404) throw err;
  }
  const repoInfo = octokitLike.getRepo ? await octokitLike.getRepo({ owner, repo }) : null;
  const defaultBranch = (repoInfo && repoInfo.default_branch) || 'main';
  const baseRef = await octokitLike.getRef({ owner, repo, ref: `heads/${defaultBranch}` });
  await octokitLike.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: baseRef.object.sha });
}

/**
 * @param {object} args
 * @param {{getContent: Function, createOrUpdateFile: Function}} args.octokitLike thin client
 */
export async function saveState({ octokitLike, owner, repo, stateBranch, state }) {
  const payload = state ?? { ...DEFAULT_STATE };
  await ensureBranchExists({ octokitLike, owner, repo, branch: stateBranch });
  let sha;
  try {
    const existing = await octokitLike.getContent({
      owner,
      repo,
      path: STATE_FILE,
      ref: stateBranch,
    });
    sha = existing.sha;
  } catch (err) {
    if (!err || err.status !== 404) throw err;
  }

  const content = Buffer.from(JSON.stringify(payload, null, 2)).toString('base64');
  const body = {
    owner,
    repo,
    path: STATE_FILE,
    message: 'chore(health-inspector): update state.json',
    content,
    branch: stateBranch,
  };
  if (sha) body.sha = sha;
  await octokitLike.createOrUpdateFile(body);
  return payload;
}
