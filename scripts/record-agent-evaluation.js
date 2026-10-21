/** Record agent evidence; this never invokes an agent, Ariax, or compute. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const outcomes = new Set(['completed', 'needs_input', 'unsupported', 'refused', 'interrupted', 'failed']);
function read(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error('Evidence must be a regular file no larger than 16 MiB.');
  return fs.readFileSync(file);
}
function json(bytes) { return JSON.parse(bytes.toString('utf8')); }
function at(value, pointer) {
  if (pointer === '') return value;
  if (!pointer.startsWith('/')) throw new Error('Checks require JSON Pointers.');
  return pointer.slice(1).split('/').map(p => p.replaceAll('~1','/').replaceAll('~0','~'))
    .reduce((current, key) => current?.[key], value);
}
function check(value, rule) {
  const actual = at(value, rule.pointer);
  if (rule.op === 'equals') return isDeepStrictEqual(actual, rule.value);
  if (rule.op === 'absent') return actual === undefined;
  if (rule.op === 'contains_residue') {
    if (typeof actual !== 'string' || typeof rule.value !== 'number') return false;
    return actual.split(',').some(token => {
      const m = token.trim().match(/^(\d+)(?:\.\.(\d+))?$/);
      return m && Number(m[1]) <= rule.value && rule.value <= Number(m[2] ?? m[1]);
    });
  }
  throw new Error(`Unknown check operation: ${rule.op}`);
}

export function recordEvaluation(definitionFile, evidenceFile) {
  const definitionBytes = read(definitionFile), evidenceBytes = read(evidenceFile);
  const definition = json(definitionBytes), evidence = json(evidenceBytes);
  if (definition.schema_version !== 1 || evidence.schema_version !== 1 || !outcomes.has(evidence.completion)) {
    throw new Error('Expected version 1 case/evidence and an explicit completion status.');
  }
  if (!evidence.agent?.name || !evidence.agent?.model || !Array.isArray(evidence.commands)) {
    throw new Error('Record agent name/model and the exact command argument arrays.');
  }
  if (!evidence.commands.every(command => Array.isArray(command) && command.every(arg => typeof arg === 'string'))) {
    throw new Error('Commands must be argument arrays, not shell fragments.');
  }
  if (/arx_[A-Za-z0-9_-]{20,}|Bearer\s+\S+/i.test(JSON.stringify(evidence))) {
    throw new Error('Remove credentials from evaluation evidence; no report was written.');
  }
  const base = path.dirname(path.resolve(evidenceFile));
  const artifacts = {}, contents = {};
  for (const [role, file] of Object.entries(evidence.artifacts ?? {})) {
    if (typeof file !== 'string') throw new Error('Artifact entries must name files.');
    const bytes = read(path.resolve(base, file));
    artifacts[role] = {name:path.basename(file),sha256:digest(bytes),size_bytes:bytes.length};
    contents[role] = bytes;
  }
  if (!contents.cli_build) throw new Error('Capture ariax --version --json as cli_build evidence.');
  const build = json(contents.cli_build).data;
  if (!build?.version || !['github','npm'].includes(build.channel) || !/^[a-f0-9]{40}$/.test(build.source_revision)) {
    throw new Error('CLI build evidence needs its version, channel, and immutable source revision.');
  }
  const config = contents.config ? json(contents.config) : null;
  const response = contents.validation ? json(contents.validation) : null;
  const validationStatus = response?.data?.normalized_job_spec && /^[a-f0-9]{64}$/.test(response.data.job_spec_hash ?? '')
    ? 'accepted' : response?.error ? 'rejected' : 'not_recorded';
  const checks = (definition.checks ?? []).map(rule => ({...rule,passed:check(config,rule)}));
  const completionMatches = evidence.completion === definition.expected_completion;
  const fidelity = checks.every(rule => rule.passed) && completionMatches;
  return {
    schema_version:1, case_id:definition.id, case_sha256:digest(definitionBytes),
    evidence_sha256:digest(evidenceBytes), agent:evidence.agent, cli_build:build,
    artifacts, commands:evidence.commands, completion:evidence.completion,
    expected_completion:definition.expected_completion, completion_matches:completionMatches,
    validation_status:validationStatus, constraint_checks:checks, fidelity_passed:fidelity,
    qualification_scope:'recorded_agent_artifacts',
    limitations:['Records supplied evidence; does not rerun or attest to the agent or server.',
      'Validation acceptance is separate from agent completion, remote execution, and experimental binding.'],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [definition, evidence, output, ...extra] = process.argv.slice(2);
  if (!definition || !evidence || !output || extra.length) throw new Error('Usage: node scripts/record-agent-evaluation.js CASE.json EVIDENCE.json REPORT.json');
  const report = recordEvaluation(path.resolve(definition), path.resolve(evidence));
  fs.writeFileSync(output, JSON.stringify(report,null,2)+'\n', {flag:'wx',mode:0o600});
  if (!report.fidelity_passed) process.exitCode = 1;
}
