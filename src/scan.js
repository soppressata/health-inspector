import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist']);

export const SCAN_RULES = {
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

function normalizeRel(p) {
  return path.normalize(String(p)).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function matchesPaths(file, paths) {
  if (!paths || paths.length === 0) return true;
  const f = normalizeRel(file);
  return paths.some((p) => {
    const np = normalizeRel(p);
    return f === np || f.startsWith(np + '/');
  });
}

function isIgnored(file) {
  return file.split(/[\\/]/).some((seg) => IGNORE_DIRS.has(seg));
}

function matchesFileTypes(file, fileTypes) {
  if (!fileTypes || fileTypes.length === 0) return true;
  const ext = path.extname(file).slice(1);
  return fileTypes.includes(ext);
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

function changedFilesSince(rootDir, sinceRef) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${sinceRef}...HEAD`], {
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
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function allTracked(rootDir) {
  try {
    const tracked = execFileSync('git', ['ls-files'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const files = [...tracked.split('\n'), ...untracked.split('\n')].map((s) => s.trim()).filter(Boolean);
    if (files.length > 0) return files;
  } catch {
    // fall through to a plain walk of the tree
  }
  return walk(rootDir).map((p) => path.relative(rootDir, p));
}

function readLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n');
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
  const basename = path.basename(file).replace(/\.[^.]+$/, '');
  const testsDir = path.join(rootDir, 'tests');

  let referenced = false;
  if (fs.existsSync(testsDir)) {
    const testFiles = walk(testsDir).filter((p) => /\.(js|jsx|ts|tsx)$/.test(p));
    referenced = testFiles.some((p) => {
      try {
        return fs.readFileSync(p, 'utf8').includes(basename);
      } catch {
        return false;
      }
    });
  }

  if (referenced) return [];
  return [candidate('untested_new_function', file, exportLine + 1, (lines[exportLine] || '').trim())];
}

export function listRules() {
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

export async function scanRepo({ rootDir, sinceRef, maxCandidates, oversizedLines, rules, excludeRules, paths } = {}) {
  if (maxCandidates !== undefined && (!Number.isInteger(maxCandidates) || maxCandidates <= 0)) {
    throw new TypeError('scanRepo: maxCandidates must be a positive integer');
  }
  if (oversizedLines !== undefined && (!Number.isInteger(oversizedLines) || oversizedLines <= 0)) {
    throw new TypeError('scanRepo: oversizedLines must be a positive integer');
  }

  validateRuleNames(rules, 'rules');
  validateRuleNames(excludeRules, 'excludeRules');

  if (paths !== undefined && !Array.isArray(paths)) {
    throw new TypeError('scanRepo: paths must be an array');
  }

  const ruleNames = listRules();
  const enabledRules = new Set(rules && rules.length > 0 ? rules : ruleNames);
  if (excludeRules) {
    for (const r of excludeRules) enabledRules.delete(r);
  }

  const threshold = oversizedLines ?? 80;
  const dir = path.resolve(rootDir || process.cwd());
  const normalizedPaths = (paths || []).map(normalizeRel).filter(Boolean);

  let files = sinceRef ? changedFilesSince(dir, sinceRef) : null;
  if (!files) files = allTracked(dir);
  files = files.filter((f) => !isIgnored(f)).filter((f) => matchesPaths(f, normalizedPaths));

  const candidates = [];
  for (const file of files) {
    const abs = path.join(dir, file);
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
