import { completeOpenAI } from './openai.js';
import { completeClaude } from './claude.js';
import { completeKimi } from './kimi.js';
import { completeHermes } from './hermes.js';
import { completeOpenCode } from './opencode.js';

export const PROVIDERS = {
  openai: completeOpenAI,
  claude: completeClaude,
  anthropic: completeClaude,
  kimi: completeKimi,
  moonshot: completeKimi,
  hermes: completeHermes,
  opencode: completeOpenCode,
};

export function resolveProvider(name = 'openai') {
  const key = String(name || 'openai').toLowerCase();
  const fn = PROVIDERS[key];
  if (!fn) {
    throw new Error(
      `Unknown provider '${name}'. Supported: ${Object.keys(PROVIDERS).filter((k) => !['anthropic', 'moonshot'].includes(k)).join(', ')}`,
    );
  }
  return fn;
}

export function listProviders() {
  return ['openai', 'claude', 'kimi', 'hermes', 'opencode'];
}
