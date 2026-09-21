import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/main.js';
import { prepareBindcraft2Bundle, requiredBindcraft2Inputs } from '../src/bindcraft2-inputs.js';

const root = fileURLToPath(new URL('../agent-skills/examples/', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/bindcraft2-example-bundle/', import.meta.url));
const exampleFiles = [
  path.join(root, 'bindcraft2-pilot.json'),
  ...fs.readdirSync(path.join(root, 'bindcraft2-formats'))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(root, 'bindcraft2-formats', name)),
];

async function captureOutput(fn) {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = '';
  let stderr = '';
  process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
  process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
  try { return { code: await fn(), stdout, stderr }; }
  finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

function load(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

describe('BindCraft2 packaged examples', () => {
  it('covers every native base format with bounded pilot settings', () => {
    const directory = path.join(root, 'bindcraft2-formats');
    const jobs = fs.readdirSync(directory).filter((name) => name.endsWith('.json')).map((name) => (
      JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
    ));
    const modalities = new Set(jobs.map((job) => job.protocol_config.modality[0]));
    assert.deepEqual(modalities, new Set([
      'binder', 'large_binder', 'peptide', 'cyclic_peptide', 'VHH',
      'scFv', 'Fab', 'ARP', 'homo_oligomer', 'multidomain',
    ]));
    for (const job of jobs) {
      assert.equal(job.protocol, 'bindcraft2');
      assert.equal(job.protocol_config.targets[0].input_file, 'input.pdb');
      assert.equal(job.protocol_config.campaign.num_designs, 2);
      assert.equal(job.protocol_config.campaign.max_trajectories, 20);
    }
  });

  it('includes secondary FASTA and custom-scaffold bundle recipes', () => {
    const load = (name) => JSON.parse(fs.readFileSync(path.join(root, 'bindcraft2-formats', name), 'utf8'));
    const multi = load('multistate-secondary-fasta.json');
    assert.equal(multi.protocol_config.targets[1].input_file, 'homolog.fasta');
    assert.deepEqual(multi.protocol_config.advanced.crop_fasta_sequence, [10, 40]);
    const custom = load('custom-scaffold.json');
    assert.equal(custom.protocol_config.binder.scaffold_file, 'custom-vhh.cif');
    assert.match(custom.protocol_config.binder.mutate_positions, /A50-65/);
  });

  it('offers RTX6000PRO as a primary eligible GPU in every new BindCraft2 template', () => {
    for (const jobFile of exampleFiles) {
      const job = load(jobFile);
      assert.deepEqual(job.allowed_gpus, ['H100', 'RTX6000PRO'], path.basename(jobFile));
      assert.ok(!job.allowed_gpus.includes('RTX6000ADA'), path.basename(jobFile));
      assert.ok(!job.allowed_gpus.includes('A6000'), path.basename(jobFile));
    }
  });

  it('inspects and prepares all 13 packaged examples through the actual CLI', async () => {
    assert.equal(exampleFiles.length, 13);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-bc2-examples-'));
    try {
      for (const [index, jobFile] of exampleFiles.entries()) {
        const job = load(jobFile);
        const inspected = await captureOutput(() => main([
          'inputs', 'inspect', '--input-dir', fixture, '-f', jobFile, '--json',
        ], { NO_UPDATE_NOTIFIER: '1' }));
        assert.equal(inspected.code, 0, `inspect failed for ${path.basename(jobFile)}: ${inspected.stdout}\n${inspected.stderr}`);
        const inspection = JSON.parse(inspected.stdout).data;
        assert.equal(inspection.ready, true);
        assert.equal(inspection.protocol, 'bindcraft2');
        assert.deepEqual(inspection.files.map((file) => file.filename).sort(), requiredBindcraft2Inputs(job));
        assert.equal(JSON.stringify(inspection).includes('sha256'), false);

        const output = path.join(temporary, String(index));
        const prepared = await captureOutput(() => main([
          'inputs', 'prepare', '--input-dir', fixture, '-f', jobFile,
          '--output', output, '--json',
        ], { NO_UPDATE_NOTIFIER: '1' }));
        assert.equal(prepared.code, 0, `prepare failed for ${path.basename(jobFile)}: ${prepared.stdout}\n${prepared.stderr}`);
        const expected = [...requiredBindcraft2Inputs(job), 'input-manifest.json', 'job.json'].sort();
        assert.deepEqual(fs.readdirSync(output).sort(), expected);
        const manifest = JSON.parse(fs.readFileSync(path.join(output, 'input-manifest.json'), 'utf8'));
        assert.deepEqual(Object.keys(manifest.files).sort(), requiredBindcraft2Inputs(job));
      }
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

  it('uses structurally parseable fixtures with the required author residues and records', () => {
    const target = load(path.join(root, 'bindcraft2-pilot.json'));
    target.protocol_config.targets[0].hotspots = '';
    target.protocol_config.targets[0].coldspots = '';
    const targetBundle = prepareBindcraft2Bundle({ spec: target, inputDir: fixture });
    assert.deepEqual(targetBundle.required, ['input.pdb']);

    const custom = load(path.join(root, 'bindcraft2-formats', 'custom-scaffold.json'));
    custom.protocol_config.targets[0].hotspots = '';
    custom.protocol_config.targets[0].coldspots = '';
    custom.protocol_config.binder.mutate_positions = 'A1,X7';
    assert.doesNotThrow(() => prepareBindcraft2Bundle({ spec: custom, inputDir: fixture }));

    const multistate = load(path.join(root, 'bindcraft2-formats', 'multistate-secondary-fasta.json'));
    multistate.protocol_config.targets[0].hotspots = '';
    multistate.protocol_config.targets[0].coldspots = '';
    assert.doesNotThrow(() => prepareBindcraft2Bundle({ spec: multistate, inputDir: fixture }));
  });

  it('accepts native multi-digit target spans with first-chain binding and reversible ranges', () => {
    const base = load(path.join(root, 'bindcraft2-pilot.json'));
    for (const [hotspots, coldspots] of [
      ['A54', 'A60'],
      ['54', '60'],
      ['A54-56', 'A60-62'],
      ['A56-54', 'A62-60'],
    ]) {
      const job = structuredClone(base);
      job.protocol_config.targets[0].hotspots = hotspots;
      job.protocol_config.targets[0].coldspots = coldspots;
      assert.doesNotThrow(() => prepareBindcraft2Bundle({ spec: job, inputDir: fixture }), `${hotspots} / ${coldspots}`);
    }
  });

  it('accepts native scaffold replacement choices, ranges, markers, and allowlisted flags', () => {
    const base = load(path.join(root, 'bindcraft2-formats', 'custom-scaffold.json'));
    for (const edit of [
      'X7(5,8)',
      'A50-55(5-8)',
      'A54*',
      'A54!',
      'A54+NONE,A55-DESIGN,A56+TEMPLATE,A57-SEQUENCE,A58+CONTACT,A59-HOTSPOT,A60+COLDSPOT,A61-CYCLIC,A62+PADDING',
    ]) {
      const job = structuredClone(base);
      job.protocol_config.targets[0].hotspots = '';
      job.protocol_config.targets[0].coldspots = '';
      job.protocol_config.binder.mutate_positions = edit;
      assert.doesNotThrow(() => prepareBindcraft2Bundle({ spec: job, inputDir: fixture }), edit);
    }
  });

  it('rejects target-only edit syntax and malformed or out-of-bounds scaffold edits', () => {
    const target = load(path.join(root, 'bindcraft2-pilot.json'));
    for (const selection of ['A54(5,8)', 'A54*', 'A54+DESIGN']) {
      const job = structuredClone(target);
      job.protocol_config.targets[0].hotspots = selection;
      assert.throws(() => prepareBindcraft2Bundle({ spec: job, inputDir: fixture }), /invalid native residue selection/, selection);
    }

    const scaffold = load(path.join(root, 'bindcraft2-formats', 'custom-scaffold.json'));
    for (const edit of ['54', 'Z7', 'A111', 'A7+UNKNOWN', 'A7(0)', 'A7(2001)', 'A7(8,,9)', 'A7,,A8', 'A7-', 'A-8']) {
      const job = structuredClone(scaffold);
      job.protocol_config.targets[0].hotspots = '';
      job.protocol_config.targets[0].coldspots = '';
      job.protocol_config.binder.mutate_positions = edit;
      assert.throws(() => prepareBindcraft2Bundle({ spec: job, inputDir: fixture }), /BindCraft2 scaffold edit|invalid native edit/, edit);
    }
  });
});
