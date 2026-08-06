import { createRequire as __WEBPACK_EXTERNAL_createRequire } from "module";
/******/ // The require scope
/******/ var __nccwpck_require__ = {};
/******/ 
/************************************************************************/
/******/ /* webpack/runtime/define property getters */
/******/ (() => {
/******/ 	// define getter functions for harmony exports
/******/ 	__nccwpck_require__.d = (exports, definition) => {
/******/ 		for(var key in definition) {
/******/ 			if(__nccwpck_require__.o(definition, key) && !__nccwpck_require__.o(exports, key)) {
/******/ 				Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 			}
/******/ 		}
/******/ 	};
/******/ })();
/******/ 
/******/ /* webpack/runtime/hasOwnProperty shorthand */
/******/ (() => {
/******/ 	__nccwpck_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ })();
/******/ 
/******/ /* webpack/runtime/compat */
/******/ 
/******/ if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = new URL('.', import.meta.url).pathname.slice(import.meta.url.match(/^file:\/\/\/\w:/) ? 1 : 0, -1) + "/";
/******/ 
/************************************************************************/
var __webpack_exports__ = {};

// EXPORTS
__nccwpck_require__.d(__webpack_exports__, {
  ns: () => (/* binding */ buildActionConfig),
  NZ: () => (/* binding */ buildGithubClientOptions),
  V4: () => (/* binding */ getInput),
  iW: () => (/* binding */ main)
});

;// CONCATENATED MODULE: external "node:child_process"
const external_node_child_process_namespaceObject = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("node:child_process");
;// CONCATENATED MODULE: external "node:fs"
const external_node_fs_namespaceObject = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("node:fs");
;// CONCATENATED MODULE: external "node:path"
const external_node_path_namespaceObject = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("node:path");
;// CONCATENATED MODULE: external "node:url"
const external_node_url_namespaceObject = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("node:url");
;// CONCATENATED MODULE: ./src/scan.js




const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist']);

const SCAN_RULES = {
  todo_fixme: { severityHint: 1, description: 'TODO or FIXME comment found', fileTypes: ['js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rb', 'rs', 'c', 'cpp', 'h', 'hpp'] },
  secret_like: { severityHint: 5, description: 'Potential secret or credential', fileTypes: [] },
  bare_except: { severityHint: 4, description: 'Bare or empty catch block', fileTypes: ['js', 'jsx', 'ts', 'tsx', 'py'] },
  untested_new_function: { severityHint: 3, description: 'New exported function has no test reference', fileTypes: ['js', 'jsx', 'ts', 'tsx'] },
  oversized_function: { severityHint: 2, description: 'Function exceeds line threshold', fileTypes: ['js', 'jsx', 'ts', 'tsx', 'py'] },
};

const SEVERITY_HINT = Object.fromEntries(
  Object.entries(SCAN_RULES).map(([k, v]) => [k, v.severityHint])
);

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /(?:api[_-]?key|apikey|secret|password)\s*[:=]\s*["'][^"']{12,}["']/i,
];

const JS_FUNC_RE =
  /\b(?:async\s+)?function\s+(?:[\w$]+\s*)?\(|\bconst\s+[\w$]+\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>\s*\{/g;

const EXPORT_FUNC_RE =
  /export\s+(?:default\s+)?(?:async\s+)?function\b|export\s+(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>|module\.exports\s*=/;

function candidate(type, file, line, snippet) {
  return { type, file, line, snippet, severity_hint: SEVERITY_HINT[type] };
}

function isIgnored(file) {
  return file.split(/[\\/]/).some((seg) => IGNORE_DIRS.has(seg));
}

function matchesFileTypes(file, fileTypes) {
  if (!fileTypes || fileTypes.length === 0) return true;
  const ext = external_node_path_namespaceObject.extname(file).slice(1);
  return fileTypes.includes(ext);
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

function changedFilesSince(rootDir, sinceRef) {
  try {
    const out = (0,external_node_child_process_namespaceObject.execFileSync)('git', ['diff', '--name-only', `${sinceRef}...HEAD`], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = external_node_fs_namespaceObject.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const p = external_node_path_namespaceObject.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function allTracked(rootDir) {
  try {
    const tracked = (0,external_node_child_process_namespaceObject.execFileSync)('git', ['ls-files'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const untracked = (0,external_node_child_process_namespaceObject.execFileSync)('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const files = [...tracked.split('\n'), ...untracked.split('\n')].map((s) => s.trim()).filter(Boolean);
    if (files.length > 0) return files;
  } catch {
    // fall through to a plain walk of the tree
  }
  return walk(rootDir).map((p) => external_node_path_namespaceObject.relative(rootDir, p));
}

function readLines(file) {
  try {
    return external_node_fs_namespaceObject.readFileSync(file, 'utf8').split('\n');
  } catch {
    return null;
  }
}

function checkTodoFixme(file, lines) {
  const out = [];
  lines.forEach((line, i) => {
    if (/TODO|FIXME/.test(line)) {
      out.push(candidate('todo_fixme', file, i + 1, line.trim()));
    }
  });
  return out;
}

function checkSecret(file, lines) {
  const out = [];
  lines.forEach((line, i) => {
    if (SECRET_PATTERNS.some((re) => re.test(line))) {
      out.push(candidate('secret_like', file, i + 1, line.trim()));
    }
  });
  return out;
}

function matchBrace(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function isCommentOnlyJs(body) {
  return (
    body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\s+/g, '').length === 0
  );
}

function checkBareExceptJs(file, lines) {
  const out = [];
  const text = lines.join('\n');
  const re = /catch\s*(?:\([^)]*\)\s*)?\{/g;
  for (const m of text.matchAll(re)) {
    const open = text.indexOf('{', m.index);
    const close = matchBrace(text, open);
    if (close === -1) continue;
    if (isCommentOnlyJs(text.slice(open + 1, close))) {
      const line = lineNumberAt(text, m.index);
      out.push(candidate('bare_except', file, line, (lines[line - 1] || '').trim()));
    }
  }
  return out;
}

function checkBareExceptPy(file, lines) {
  const out = [];
  lines.forEach((line, i) => {
    if (/^\s*except\s*:\s*(?:#.*)?$/.test(line)) {
      out.push(candidate('bare_except', file, i + 1, line.trim()));
    }
  });
  return out;
}

function checkOversizedFunctionJs(file, lines, threshold = 80) {
  const out = [];
  const text = lines.join('\n');
  for (const m of text.matchAll(JS_FUNC_RE)) {
    const startLine = lineNumberAt(text, m.index);
    let openLineIdx;
    if (m[0].includes('{')) {
      openLineIdx = startLine - 1;
    } else {
      openLineIdx = -1;
      for (let i = startLine - 1; i < lines.length; i++) {
        if (lines[i].includes('{')) {
          openLineIdx = i;
          break;
        }
      }
    }
    if (openLineIdx === -1) continue;

    let depth = 0;
    let endLine = -1;
    for (let i = openLineIdx; i < lines.length && endLine === -1; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            endLine = i + 1;
            break;
          }
        }
      }
    }
    if (endLine === -1) continue;

    const span = endLine - startLine + 1;
    if (span > threshold) {
      out.push(candidate('oversized_function', file, startLine, (lines[startLine - 1] || '').trim()));
    }
  }
  return out;
}

function checkOversizedFunctionPy(file, lines, threshold = 80) {
  const out = [];
  const defRe = /^\s*def\s+[\w$]+\s*\(/;
  lines.forEach((line, i) => {
    if (!defRe.test(line)) return;
    const indent = line.length - line.trimStart().length;
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '' || /^\s*#/.test(l)) {
        end = j;
        continue;
      }
      if (l.length - l.trimStart().length <= indent) break;
      end = j;
    }
    if (end - i + 1 > threshold) {
      out.push(candidate('oversized_function', file, i + 1, line.trim()));
    }
  });
  return out;
}

function checkUntestedNewFunction(rootDir, file, content) {
  if (!/\.(js|jsx|ts|tsx)$/.test(file)) return [];
  if (!file.startsWith('src/')) return [];
  if (!EXPORT_FUNC_RE.test(content)) return [];

  const lines = content.split('\n');
  const exportLine = lines.findIndex((l) => EXPORT_FUNC_RE.test(l));
  const basename = external_node_path_namespaceObject.basename(file).replace(/\.[^.]+$/, '');
  const testsDir = external_node_path_namespaceObject.join(rootDir, 'tests');

  let referenced = false;
  if (external_node_fs_namespaceObject.existsSync(testsDir)) {
    const testFiles = walk(testsDir).filter((p) => /\.(js|jsx|ts|tsx)$/.test(p));
    referenced = testFiles.some((p) => {
      try {
        return external_node_fs_namespaceObject.readFileSync(p, 'utf8').includes(basename);
      } catch {
        return false;
      }
    });
  }

  if (referenced) return [];
  return [candidate('untested_new_function', file, exportLine + 1, (lines[exportLine] || '').trim())];
}

function listRules() {
  return Object.keys(SCAN_RULES);
}

function validateRuleNames(names, optionName) {
  if (names === undefined) return;
  if (!Array.isArray(names)) {
    throw new TypeError(`scanRepo: ${optionName} must be an array`);
  }
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(SCAN_RULES, name)) {
      throw new TypeError(`scanRepo: ${optionName} contains unknown rule name: ${name}`);
    }
  }
}

async function scanRepo({ rootDir, sinceRef, maxCandidates, oversizedLines, rules, excludeRules } = {}) {
  if (maxCandidates !== undefined && (!Number.isInteger(maxCandidates) || maxCandidates <= 0)) {
    throw new TypeError('scanRepo: maxCandidates must be a positive integer');
  }
  if (oversizedLines !== undefined && (!Number.isInteger(oversizedLines) || oversizedLines <= 0)) {
    throw new TypeError('scanRepo: oversizedLines must be a positive integer');
  }

  validateRuleNames(rules, 'rules');
  validateRuleNames(excludeRules, 'excludeRules');

  const ruleNames = listRules();
  const enabledRules = new Set(rules && rules.length > 0 ? rules : ruleNames);
  if (excludeRules) {
    for (const r of excludeRules) enabledRules.delete(r);
  }

  const threshold = oversizedLines ?? 80;
  const dir = external_node_path_namespaceObject.resolve(rootDir || process.cwd());

  let files = sinceRef ? changedFilesSince(dir, sinceRef) : null;
  if (!files) files = allTracked(dir);
  files = files.filter((f) => !isIgnored(f));

  const candidates = [];
  for (const file of files) {
    const abs = external_node_path_namespaceObject.join(dir, file);
    const lines = readLines(abs);
    if (!lines) continue;
    const content = lines.join('\n');
    const isJsTs = /\.(js|jsx|ts|tsx)$/.test(file);
    const isPy = /\.py$/.test(file);

    if (enabledRules.has('todo_fixme') && matchesFileTypes(file, SCAN_RULES.todo_fixme.fileTypes)) {
      candidates.push(...checkTodoFixme(file, lines));
    }
    if (enabledRules.has('secret_like')) {
      candidates.push(...checkSecret(file, lines));
    }
    if (enabledRules.has('bare_except')) {
      if (isJsTs) candidates.push(...checkBareExceptJs(file, lines));
      if (isPy) candidates.push(...checkBareExceptPy(file, lines));
    }
    if (enabledRules.has('oversized_function')) {
      if (isJsTs) candidates.push(...checkOversizedFunctionJs(file, lines, threshold));
      if (isPy) candidates.push(...checkOversizedFunctionPy(file, lines, threshold));
    }
    if (enabledRules.has('untested_new_function')) {
      if (isJsTs) candidates.push(...checkUntestedNewFunction(dir, file, content));
    }
  }

  candidates.sort((a, b) => b.severity_hint - a.severity_hint);
  const cap = maxCandidates === undefined ? Infinity : maxCandidates;
  return candidates.slice(0, cap);
}

;// CONCATENATED MODULE: ./src/inspect.js
const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);
const DEFAULT_MAX_OUTPUT_TOKENS = 1000;

const SYSTEM_PROMPT = `You are a terse code auditor. A static scanner produced the numbered candidate list below. For each candidate decide whether it is a genuine code problem or a false positive (for example a harmless TODO, a placeholder value, or a misdetected test fixture).

Rules:
- Reject false positives with "confirmed": false and move on.
- Only confirm real issues; give each confirmed issue one concise reason and a severity of "low", "medium", or "high".
- Keep reasons to one sentence.

Reply with STRICT JSON only, using exactly this shape:
{
  "findings": [
    { "index": 1, "confirmed": true, "severity": "medium", "reason": "why this is a real problem" }
  ],
  "summary_markdown": "one short markdown report covering all confirmed findings"
}`;

function truncateSnippet(snippet, maxLines = 30, maxChars = 1200) {
  const text = String(snippet ?? '');
  const lines = text.split('\n');
  const marker = '... (truncated)';
  const lineLimit = Math.max(1, maxLines);
  const lineTruncated = lines.length > lineLimit;
  let result = lineTruncated ? lines.slice(0, lineLimit).join('\n') : text;
  const truncated = lineTruncated || result.length > maxChars;
  if (!truncated) return result;
  if (maxChars <= marker.length) return marker.slice(0, Math.max(0, maxChars));
  result = result.slice(0, maxChars - marker.length);
  return `${result}${marker}`;
}

function buildUserContent(candidates) {
  const entries = candidates.map((c, i) => {
    const snippet = truncateSnippet(c.snippet);
    return `${i + 1}. [${c.type}] ${c.file}:${c.line}\n\`\`\`\n${snippet}\n\`\`\``;
  });
  return `Audit these ${candidates.length} candidates:\n\n${entries.join('\n\n')}`;
}

function redactCandidate(candidate) {
  if (candidate.type !== 'secret_like') return candidate;
  return {
    ...candidate,
    snippet: String(candidate.snippet ?? '')
      .replace(/(AKIA)[0-9A-Z]{16}/g, '$1[REDACTED]')
      .replace(/(-----BEGIN )[A-Z0-9 ]+(PRIVATE KEY-----)/g, '$1[REDACTED]$2')
      .replace(/((?:api[_-]?key|apikey|secret|password)\s*[:=]\s*["'])[^"']+/gi, '$1[REDACTED]'),
  };
}

function parseJsonContent(content) {
  const text = String(content ?? '').trim();
  if (!text) throw new Error('Model response was empty');
  try {
    return JSON.parse(text);
  } catch {
    // fall through to fence / brace extraction
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through to brace extraction
    }
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // fall through
    }
  }
  throw new Error('Model response was not valid JSON');
}

function buildReport(findings, summaryMarkdown) {
  const out = ['## Health Inspector findings', ''];
  if (typeof summaryMarkdown === 'string' && summaryMarkdown.trim()) {
    out.push(summaryMarkdown.trim(), '');
  }
  if (findings.length > 0) {
    out.push('### Confirmed findings', '');
    for (const f of findings) {
      const reason = f.reason ? ` — ${f.reason}` : '';
      out.push(`- **${f.file}:${f.line}** [${f.severity}] ${f.type}${reason}`);
    }
  }
  return out.join('\n').trim();
}

async function inspectCandidates({ candidates, apiKey, baseUrl, model, maxOutputTokens, timeoutMs = 30000 } = {}) {
  const list = Array.isArray(candidates) ? candidates.map(redactCandidate) : [];
  if (list.length === 0) {
    return { findings: [], reportMarkdown: null, tokensUsed: 0 };
  }
  if (!apiKey) throw new Error('inspectCandidates: apiKey is required');
  if (!baseUrl) throw new Error('inspectCandidates: baseUrl is required');
  if (!model) throw new Error('inspectCandidates: model is required');

  const maxTokens =
    Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : DEFAULT_MAX_OUTPUT_TOKENS;
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserContent(list) },
    ],
    max_tokens: maxTokens,
    temperature: 0,
  };

  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`inspectCandidates: network error calling ${url}: ${err.message}`);
  }

  let rawText;
  try {
    rawText = await response.text();
  } catch (err) {
    throw new Error(`inspectCandidates: failed to read LLM API response: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      `inspectCandidates: LLM API error HTTP ${response.status}: ${String(rawText).slice(0, 300)}`,
    );
  }
  if (!data || !Array.isArray(data.choices) || data.choices.length === 0) {
    throw new Error('inspectCandidates: LLM API response had no choices');
  }

  const choice = data.choices[0];
  if (!choice || typeof choice !== 'object' || !choice.message || typeof choice.message !== 'object') {
    throw new Error('inspectCandidates: LLM API response had a malformed choice');
  }
  const content = choice.message.content;
  const parsed = parseJsonContent(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('inspectCandidates: model response JSON must be an object');
  }
  if (!Array.isArray(parsed.findings)) {
    throw new Error('inspectCandidates: model response findings must be an array');
  }

  const modelFindings = parsed.findings;
  const findings = [];
  for (const f of modelFindings) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
    if (f.confirmed !== true) continue;
    const index = Number(f.index);
    const candidate = list[index - 1];
    if (!candidate) continue;
    findings.push({
      ...candidate,
      confirmed: true,
      severity: VALID_SEVERITIES.has(f.severity) ? f.severity : 'medium',
      reason: String(f.reason ?? '').trim(),
    });
  }

  const tokensUsed = Number.isFinite(Number(data.usage && data.usage.total_tokens))
    ? Number(data.usage.total_tokens)
    : 0;

  const reportMarkdown = buildReport(findings, parsed.summary_markdown);
  return { findings, reportMarkdown, tokensUsed };
}

;// CONCATENATED MODULE: external "node:crypto"
const external_node_crypto_namespaceObject = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("node:crypto");
;// CONCATENATED MODULE: ./src/state.js


const STATE_FILE = 'state.json';

const DEFAULT_STATE = { lastScannedRef: null, filedFingerprints: [] };

/**
 * @param {{file?: string, type?: string, line?: number, snippet?: string}} finding
 * @returns {string} stable 12-hex fingerprint
 */
function fingerprintFinding(finding) {
  const file = String((finding && finding.file) || '');
  const type = String((finding && finding.type) || '');
  const line = String((finding && finding.line) || '');
  const snippet = String((finding && finding.snippet) || '');
  const normalized = snippet.replace(/\s+/g, ' ').trim();
  const digest = (0,external_node_crypto_namespaceObject.createHash)('sha1')
    .update(`${file}\u0000${type}\u0000${line}\u0000${normalized}`)
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
async function loadState({ octokitLike, owner, repo, stateBranch }) {
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
async function saveState({ octokitLike, owner, repo, stateBranch, state }) {
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

;// CONCATENATED MODULE: ./src/github.js


const API_BASE = 'https://api.github.com';

/**
 * Classify an HTTP status as retryable.
 * Retryable: 408, 425, 429, and any 5xx (500-599).
 * Everything else is considered permanent.
 * @param {number} status
 * @returns {boolean}
 */
function isRetryable(status) {
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
function makeGithubClient(token, options = {}) {
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

  function encodeContentPath(p) {
    return String(p).split('/').map(encodeURIComponent).join('/');
  }

  return {
    getContent: async ({ owner, repo, path, ref }) => {
      const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      return request('GET', `/repos/${owner}/${repo}/contents/${encodeContentPath(path)}${query}`);
    },
    createOrUpdateFile: async ({ owner, repo, path, ...payload }) => {
      return request('PUT', `/repos/${owner}/${repo}/contents/${encodeContentPath(path)}`, payload);
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
async function fileReport({ octokitLike, owner, repo, label, reportMarkdown, findings, state }) {
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

  const updatedState = {
    ...state,
    filedFingerprints: [...(state.filedFingerprints || [])],
  };
  for (const f of newFindings) {
    const fp = fingerprintFinding(f);
    if (!updatedState.filedFingerprints.includes(fp)) updatedState.filedFingerprints.push(fp);
  }

  return { filed: true, issueUrl: issue.html_url, newFindings, updatedState };
}

;// CONCATENATED MODULE: ./src/local-state.js







const REPLAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_LOCAL_STATE = {
  lastScannedRef: null,
  filedFingerprints: [],
  deliveries: [],
  rules: {},
};



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

function loadLocalState(filePath) {
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

function saveLocalState(filePath, state) {
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
  return (0,external_node_crypto_namespaceObject.createHash)('sha256').update(JSON.stringify(payload)).digest('hex');
}

function deliveryIdFor(payload) {
  if (payload && typeof payload === 'object' && payload.delivery_id) {
    return payload.delivery_id;
  }
  return makeDeliveryId(payload);
}

function recordDelivery(state, payload) {
  const id = deliveryIdFor(payload);
  const entry = { id, timestamp: Date.now(), payloadHash: payloadHash(payload) };
  return { ...state, deliveries: [...(state?.deliveries || []), entry] };
}

function wasDelivered(state, payload, now = Date.now()) {
  const id = deliveryIdFor(payload);
  return Array.isArray(state?.deliveries) && state.deliveries.some(
    (d) => d && d.id === id && typeof d.timestamp === 'number' && now - d.timestamp <= REPLAY_WINDOW_MS,
  );
}

;// CONCATENATED MODULE: ./src/webhook.js






const TRANSIENT = new Set([408, 425, 429]);

function validateHeaders(input = {}) {
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

function redactSensitive(value) {
  return String(value ?? '').replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED]').replace(/(["']?(?:api[_-]?key|secret|password)["']?\s*[:=]\s*["'])[^"']+/gi, '$1[REDACTED]');
}

function makeDeliveryId({ repository = '', ref = '', findings = [] } = {}) {
  return (0,external_node_crypto_namespaceObject.createHash)('sha256').update(`${repository}\0${ref}\0${findings.map((f) => `${f.file}:${f.line}:${f.type}`).join('\0')}`).digest('hex').slice(0, 32);
}

function buildWebhookPayload({ repository, ref, findings = [], reportUrl = null, deliveryId } = {}) {
  return {
    schema_version: 1, event: 'health-inspector.findings', delivery_id: deliveryId || makeDeliveryId({ repository, ref, findings }),
    repository: repository || null, ref: ref || null, findings_count: findings.length,
    findings: findings.map(({ type, file, line, severity, reason }) => ({ type, file, line, severity, reason })), report_url: reportUrl,
  };
}

function signPayload(payload, secret) {
  return (0,external_node_crypto_namespaceObject.createHmac)('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

function verifySignature(payload, secret, signature) {
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

async function sendWebhook(url, payload, {
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
    external_node_fs_namespaceObject.mkdirSync(outboxDir, { recursive: true });
    external_node_fs_namespaceObject.writeFileSync(external_node_path_namespaceObject.join(outboxDir, `${delivery}.json`), JSON.stringify(payload), 'utf8');
  }
  return result;
}

async function drainOutbox(outboxDir, sendOpts = {}) {
  if (!external_node_fs_namespaceObject.existsSync(outboxDir)) return { delivered: 0, failed: 0, remaining: 0 };
  const { url, ...rest } = sendOpts;
  const files = external_node_fs_namespaceObject.readdirSync(outboxDir).filter((f) => f.endsWith('.json'));
  let delivered = 0;
  let failed = 0;
  for (const file of files) {
    const fullPath = external_node_path_namespaceObject.join(outboxDir, file);
    const payload = JSON.parse(external_node_fs_namespaceObject.readFileSync(fullPath, 'utf8'));
    const result = await sendWebhook(url, payload, { ...rest, outboxDir: undefined, drainPrevious: false });
    if (result.delivered) {
      external_node_fs_namespaceObject.unlinkSync(fullPath);
      delivered += 1;
    } else if (result.skipped) {
      external_node_fs_namespaceObject.unlinkSync(fullPath);
    } else {
      failed += 1;
    }
  }
  const remaining = external_node_fs_namespaceObject.existsSync(outboxDir) ? external_node_fs_namespaceObject.readdirSync(outboxDir).filter((f) => f.endsWith('.json')).length : 0;
  return { delivered, failed, remaining };
}

async function notifyWebhook(options) {
  if (!options || !options.url || !options.findings || options.findings.length === 0) return { delivered: false, skipped: true };
  const payload = buildWebhookPayload(options);
  return sendWebhook(options.url, payload, options);
}

;// CONCATENATED MODULE: ./src/config.js



const DEFAULT_CONFIG = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: undefined,
  maxCandidates: 15,
  probability: 1.0,
  paths: '.',
  label: 'health-inspector',
  stateBranch: 'health-inspector-state',
  githubToken: undefined,
  webhookUrl: undefined,
  webhookHeaders: {},
  webhookSecret: undefined,
  webhookSecretHeader: 'X-Health-Inspector-Secret',
  webhookTimeoutMs: 5000,
  webhookRetries: 3,

  webhookSignatureHeader: 'X-Health-Inspector-Signature',
  webhookSigningSecret: undefined,
  scanPaths: [],
  sinceRef: undefined,
  rules: undefined,
  excludeRules: [],
  oversizedFunctionLines: 80,
  failOn: 'all',
  stateFile: '.health-inspector/state.json',
  outboxDir: '.health-inspector/outbox',
};

const CONFIG_FILE = '.health-inspector.json';

function loadConfigFile(cwd) {
  const file = external_node_path_namespaceObject.resolve(cwd || process.cwd(), CONFIG_FILE);
  try {
    const raw = external_node_fs_namespaceObject.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err instanceof SyntaxError)) return {};
    throw err;
  }
}

const ENV_MAP = [
  ['HEALTH_INSPECTOR_API_KEY', 'apiKey', (v) => v],
  ['HEALTH_INSPECTOR_BASE_URL', 'baseUrl', (v) => v],
  ['HEALTH_INSPECTOR_MODEL', 'model', (v) => v],
  ['HEALTH_INSPECTOR_MAX_CANDIDATES', 'maxCandidates', (v) => Number.parseInt(v, 10)],
  ['HEALTH_INSPECTOR_PROBABILITY', 'probability', (v) => Number.parseFloat(v)],
  ['HEALTH_INSPECTOR_LABEL', 'label', (v) => v],
  ['HEALTH_INSPECTOR_WEBHOOK_URL', 'webhookUrl', (v) => v],
  ['HEALTH_INSPECTOR_WEBHOOK_SECRET', 'webhookSecret', (v) => v],
  ['HEALTH_INSPECTOR_WEBHOOK_SIGNING_SECRET', 'webhookSigningSecret', (v) => v],
  ['HEALTH_INSPECTOR_STATE_FILE', 'stateFile', (v) => v],
  ['HEALTH_INSPECTOR_STATE_BRANCH', 'stateBranch', (v) => v],
  ['HEALTH_INSPECTOR_FAIL_ON', 'failOn', (v) => v],
  ['HEALTH_INSPECTOR_RULES', 'rules', (v) => v.split(',').map((s) => s.trim()).filter(Boolean)],
  ['HEALTH_INSPECTOR_EXCLUDE_RULES', 'excludeRules', (v) => v.split(',').map((s) => s.trim()).filter(Boolean)],
];

function envToConfig(env) {
  const out = {};
  const src = env || {};
  for (const [envVar, key, transform] of ENV_MAP) {
    const raw = src[envVar];
    if (raw === undefined || raw === '') continue;
    out[key] = transform(raw);
  }
  return out;
}

function defineFrom(target, source) {
  if (!source) return target;
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) target[key] = value;
  }
  return target;
}

function validateConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('config must be an object');
  }
  if (config.maxCandidates !== undefined) {
    if (!Number.isInteger(config.maxCandidates) || config.maxCandidates <= 0) {
      throw new Error(`maxCandidates must be a positive integer, got ${config.maxCandidates}`);
    }
  }
  if (config.probability !== undefined) {
    if (typeof config.probability !== 'number' || !Number.isFinite(config.probability) || config.probability < 0 || config.probability > 1) {
      throw new Error(`probability must be a number in [0, 1], got ${config.probability}`);
    }
  }
  if (config.oversizedFunctionLines !== undefined) {
    if (!Number.isInteger(config.oversizedFunctionLines) || config.oversizedFunctionLines <= 0) {
      throw new Error(`oversizedFunctionLines must be a positive integer, got ${config.oversizedFunctionLines}`);
    }
  }
  if (config.webhookTimeoutMs !== undefined) {
    if (!Number.isInteger(config.webhookTimeoutMs) || config.webhookTimeoutMs <= 0) {
      throw new Error(`webhookTimeoutMs must be a positive integer, got ${config.webhookTimeoutMs}`);
    }
  }
  if (config.webhookRetries !== undefined) {
    if (!Number.isInteger(config.webhookRetries) || config.webhookRetries < 0) {
      throw new Error(`webhookRetries must be a non-negative integer, got ${config.webhookRetries}`);
    }
  }
  if (config.failOn !== undefined) {
    const valid = new Set(['none', 'low', 'medium', 'high', 'all']);
    if (!valid.has(config.failOn)) {
      throw new Error(`failOn must be one of none|low|medium|high|all, got ${config.failOn}`);
    }
  }
  if (config.rules !== undefined && config.rules !== null) {
    if (!Array.isArray(config.rules)) {
      throw new Error(`rules must be an array, got ${typeof config.rules}`);
    }
    if (!config.rules.every((r) => typeof r === 'string')) {
      throw new Error('rules must be an array of strings');
    }
  }
  if (config.excludeRules !== undefined && config.excludeRules !== null) {
    if (!Array.isArray(config.excludeRules)) {
      throw new Error(`excludeRules must be an array, got ${typeof config.excludeRules}`);
    }
    if (!config.excludeRules.every((r) => typeof r === 'string')) {
      throw new Error('excludeRules must be an array of strings');
    }
  }
  return config;
}

function resolveConfig({ flags, env, fileConfig, defaults } = {}) {
  const base = Object.assign({}, DEFAULT_CONFIG, defaults || {});
  const envConfig = envToConfig(env);
  const out = Object.assign({}, base);
  defineFrom(out, fileConfig);
  defineFrom(out, envConfig);
  defineFrom(out, flags);
  validateConfig(out);
  return out;
}

;// CONCATENATED MODULE: ./src/index.js












/**
 * Read a GitHub Actions input from the environment. Input names are mapped
 * to process.env with the INPUT_ prefix and upper-cased dashes, e.g.
 * input `api-key` -> process.env['INPUT_API-KEY'].
 * @param {string} name
 * @returns {string | undefined}
 */
function getInput(name) {
  return process.env[`INPUT_${String(name).toUpperCase()}`];
}

function log(...args) {
  console.log('[health-inspector]', ...args);
}

function parseOwnerRepo(value) {
  const [owner, repo] = String(value || '').split('/');
  if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: '${value}'`);
  return { owner, repo };
}

function headRef(rootDir) {
  return (0,external_node_child_process_namespaceObject.execFileSync)('git', ['rev-parse', 'HEAD'], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writeOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  const line = `${name}=${value}`;
  if (file) {
    external_node_fs_namespaceObject.appendFileSync(file, `${line}\n`, 'utf8');
  } else {
    log(line);
  }
}

function parseWebhookHeaders(value) {
  if (!value) return {};
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error('Invalid webhook-headers: expected a JSON object'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid webhook-headers: expected a JSON object');
  return parsed;
}

/**
 * Read a single Action input, returning `undefined` (not '') for empty values
 * so that `resolveConfig`'s `defineFrom` falls back to file/env/default values.
 * @param {string} name
 * @returns {string | undefined}
 */
function input(name) {
  const value = getInput(name);
  return value === undefined || value === '' ? undefined : value;
}

function intInput(name) {
  const value = input(name);
  return value === undefined ? undefined : Number.parseInt(value, 10);
}

function floatInput(name) {
  const value = input(name);
  return value === undefined ? undefined : Number.parseFloat(value);
}

/**
 * Build the resolved configuration the same way the CLI does: merge Action
 * inputs (flags) > environment variables > `.health-inspector.json` >
 * defaults. Extracted from `main()` so the merge logic is unit-testable.
 *
 * @param {string} rootDir - repository root (the `paths` input resolved).
 * @returns {object} fully-resolved, validated config.
 */
function buildActionConfig(rootDir) {
  const webhookHeadersInput = input('webhook-headers');
  const flags = {
    apiKey: input('api-key'),
    baseUrl: input('base-url'),
    model: input('model'),
    maxCandidates: intInput('max-candidates'),
    probability: floatInput('probability'),
    label: input('label'),
    stateBranch: input('state-branch'),
    githubToken: input('github-token'),
    webhookUrl: input('webhook-url'),
    webhookHeaders: webhookHeadersInput ? parseWebhookHeaders(webhookHeadersInput) : undefined,
    webhookSecret: input('webhook-secret'),
    webhookSecretHeader: input('webhook-secret-header'),
    webhookTimeoutMs: intInput('webhook-timeout-ms'),
    webhookRetries: intInput('webhook-retries'),
    webhookSigningSecret: input('webhook-signing-secret'),
    webhookSignatureHeader: input('webhook-signature-header'),
    scanPaths: (() => {
      const raw = input('scan-paths');
      if (!raw) return undefined;
      return raw.split(/\s+/).map(s => s.trim()).filter(Boolean);
    })(),
  };
  return resolveConfig({
    flags,
    env: process.env,
    fileConfig: loadConfigFile(rootDir),
    defaults: {},
  });
}

/**
 * Build the timeout/retry options for the GitHub client from Action inputs.
 * Extracted so the input parsing is unit-testable.
 * @returns {{timeoutMs: number, maxRetries: number}}
 */
function buildGithubClientOptions() {
  return {
    timeoutMs: Number.parseInt(getInput('github-request-timeout-ms') || '15000', 10),
    maxRetries: Number.parseInt(getInput('github-max-retries') || '3', 10),
  };
}

async function main() {
  const rootDir = external_node_path_namespaceObject.resolve(input('paths') || '.');
  const config = buildActionConfig(rootDir);
  const { owner, repo } = parseOwnerRepo(process.env.GITHUB_REPOSITORY);

  if (!config.apiKey) throw new Error('Missing required input: api-key');
  if (!config.githubToken) throw new Error('Missing required input: github-token');

  if (Math.random() > config.probability) {
    log('Inspection skipped this cycle (unannounced by design).');
    writeOutput('findings-count', '0');
    return;
  }

  const githubToken = config.githubToken;
  const github = makeGithubClient(githubToken, buildGithubClientOptions());
  const loaded = await loadState({ octokitLike: github, owner, repo, stateBranch: config.stateBranch });

  const candidates = await scanRepo({
    rootDir,
    sinceRef: loaded.lastScannedRef,
    maxCandidates: config.maxCandidates,
    oversizedLines: config.oversizedFunctionLines,
    rules: config.rules,
    excludeRules: config.excludeRules,
  });
  const currentRef = headRef(rootDir);

  if (candidates.length === 0) {
    log(`Clean bill of health (${currentRef}); nothing to inspect.`);
    await saveState({
      octokitLike: github,
      owner,
      repo,
      stateBranch: config.stateBranch,
      state: { ...loaded, lastScannedRef: currentRef },
    });
    writeOutput('findings-count', '0');
    return;
  }

  log(`Found ${candidates.length} candidate(s); asking the model to inspect.`);
  const { findings, reportMarkdown } = await inspectCandidates({
    candidates,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
  });
  const state = { ...loaded, lastScannedRef: currentRef };
  const result = await fileReport({
    octokitLike: github,
    owner,
    repo,
    label: config.label,
    reportMarkdown,
    findings,
    state,
  });
  await saveState({
    octokitLike: github,
    owner,
    repo,
    stateBranch: config.stateBranch,
    state: result.updatedState,
  });

  if (config.webhookUrl && result.newFindings && result.newFindings.length > 0) {
    const webhook = await notifyWebhook({
      url: config.webhookUrl,
      repository: `${owner}/${repo}`,
      ref: currentRef,
      findings: result.newFindings,
      reportUrl: result.issueUrl || null,
      headers: config.webhookHeaders,
      secret: config.webhookSecret,
      secretHeader: config.webhookSecretHeader,
      timeoutMs: config.webhookTimeoutMs,
      retries: config.webhookRetries,
      signingSecret: config.webhookSigningSecret,
      signatureHeader: config.webhookSignatureHeader,
    });
    writeOutput('webhook-delivered', String(Boolean(webhook.delivered)));
    if (webhook.delivered) {
      writeOutput('webhook-delivery-id', webhook.deliveryId);
    }
    if (!webhook.delivered) log(`Webhook delivery failed after ${webhook.attempts || 1} attempt(s); continuing.`);
  }

  writeOutput('findings-count', String(findings.length));
  if (result.filed && result.issueUrl) writeOutput('report-url', result.issueUrl);
  log(
    result.filed
      ? `Filed report with ${findings.length} finding(s): ${result.issueUrl}`
      : `No new findings to report (all ${findings.length} already filed).`,
  );
}

const isMain = process.argv[1] && external_node_path_namespaceObject.resolve(process.argv[1]) === (0,external_node_url_namespaceObject.fileURLToPath)(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error('[health-inspector]', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

var __webpack_exports__buildActionConfig = __webpack_exports__.ns;
var __webpack_exports__buildGithubClientOptions = __webpack_exports__.NZ;
var __webpack_exports__getInput = __webpack_exports__.V4;
var __webpack_exports__main = __webpack_exports__.iW;
export { __webpack_exports__buildActionConfig as buildActionConfig, __webpack_exports__buildGithubClientOptions as buildGithubClientOptions, __webpack_exports__getInput as getInput, __webpack_exports__main as main };
