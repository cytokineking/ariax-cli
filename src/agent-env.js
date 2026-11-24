/** Shared detection for coding-agent shells and non-interactive CI environments. */

export const AGENT_SHELL_ENV_VARS = Object.freeze([
  'CODEX_THREAD_ID',
  'CLAUDECODE',
  'CURSOR_AGENT',
  'CURSOR_TRACE_ID',
  'ANTIGRAVITY_AGENT',
  'ANTIGRAVITY_SESSION_ID',
  'GEMINI_CLI',
  'CLINE_TASK_ID',
  'OPENCODE',
  'WINDSURF_SESSION',
  'AIDER',
  'ARIAX_AGENT',
]);

function isTruthyEnv(value) {
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== '' && normalized !== '0' && normalized !== 'false';
}

/** Return the detected coding-agent shell identifier, or null when absent. */
export function detectAgentShell(env = process.env) {
  if (!env || typeof env !== 'object') return null;
  if (isTruthyEnv(env.CODEX_THREAD_ID)) return 'codex';
  if (env.CLAUDECODE === '1') return 'claude-code';
  if (isTruthyEnv(env.CURSOR_AGENT) || isTruthyEnv(env.CURSOR_TRACE_ID)) return 'cursor';
  if (isTruthyEnv(env.ANTIGRAVITY_AGENT) || isTruthyEnv(env.ANTIGRAVITY_SESSION_ID)) return 'antigravity';
  if (isTruthyEnv(env.GEMINI_CLI)) return 'gemini-cli';
  if (isTruthyEnv(env.CLINE_TASK_ID)) return 'cline';
  if (isTruthyEnv(env.OPENCODE)) return 'opencode';
  if (isTruthyEnv(env.WINDSURF_SESSION)) return 'windsurf';
  if (isTruthyEnv(env.AIDER)) return 'aider';
  if (env.ARIAX_AGENT === '1') return 'agent';
  return null;
}

/** Return true when running in CI. */
export function isCiEnv(env = process.env) {
  return isTruthyEnv(env?.CI);
}

/** Return true when interactive terminal prompts must be disabled. */
export function isNonInteractiveEnv(env = process.env) {
  return Boolean(detectAgentShell(env) || isCiEnv(env));
}
