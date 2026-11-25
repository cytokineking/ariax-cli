/** `ariax schema <protocol>` — fetch JSON Schema (GET /api/v1/protocols/{id}/schema) or bundled starter examples. */
import fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printJson, printData, printProgress } from '../output.js';
import { EXIT } from '../exit-codes.js';
import { usageError } from '../args.js';

const EXAMPLES_ROOT = fileURLToPath(new URL('../../agent-skills/examples/', import.meta.url));

const CANONICAL_PROTOCOL = Object.freeze({
  bindcraft: 'bindcraft-v1.5',
  'bindcraft-v1.5': 'bindcraft-v1.5',
  bindcraft2: 'bindcraft2',
  boltzgen: 'boltzgen',
  pxdesign: 'pxdesign',
  esmfold2: 'esmfold2-pipeline',
  'esmfold2-pipeline': 'esmfold2-pipeline',
});

const BUNDLED_EXAMPLES = Object.freeze({
  'bindcraft-v1.5': {
    defaultKey: 'default',
    files: {
      default: 'bindcraft-v1.5.json',
      miniprotein: 'bindcraft-v1.5.json',
      peptide: 'bindcraft-peptide.json',
      override: 'bindcraft-override.json',
    },
  },
  bindcraft2: {
    defaultKey: 'pilot',
    files: {
      pilot: 'bindcraft2-pilot.json',
      miniprotein: 'bindcraft2-formats/miniprotein.json',
      binder: 'bindcraft2-formats/miniprotein.json',
      peptide: 'bindcraft2-formats/peptide.json',
      'cyclic-peptide': 'bindcraft2-formats/cyclic-peptide.json',
      vhh: 'bindcraft2-formats/vhh.json',
      nanobody: 'bindcraft2-formats/vhh.json',
      scfv: 'bindcraft2-formats/scfv.json',
      fab: 'bindcraft2-formats/fab.json',
      arp: 'bindcraft2-formats/arp.json',
      darpin: 'bindcraft2-formats/arp.json',
      'custom-scaffold': 'bindcraft2-formats/custom-scaffold.json',
      'homo-oligomer': 'bindcraft2-formats/homo-oligomer.json',
      'large-binder': 'bindcraft2-formats/large-binder.json',
      multidomain: 'bindcraft2-formats/multidomain.json',
      'multistate-secondary-fasta': 'bindcraft2-formats/multistate-secondary-fasta.json',
      multistate: 'bindcraft2-formats/multistate-secondary-fasta.json',
    },
  },
  boltzgen: {
    defaultKey: 'default',
    files: {
      default: 'boltzgen.json',
      miniprotein: 'boltzgen.json',
      vhh: 'boltzgen-vhh.json',
      nanobody: 'boltzgen-vhh.json',
      peptide: 'boltzgen-peptide.json',
      'cyclic-peptide': 'boltzgen-cyclic-peptide.json',
      helicon: 'boltzgen-helicon.json',
      'miniprotein-small-molecule': 'boltzgen-miniprotein-small-molecule.json',
      'small-molecule': 'boltzgen-miniprotein-small-molecule.json',
      'small-molecule-smiles': 'boltzgen-small-molecule-smiles.json',
      smiles: 'boltzgen-small-molecule-smiles.json',
    },
  },
  pxdesign: {
    defaultKey: 'default',
    files: {
      default: 'pxdesign.json',
      miniprotein: 'pxdesign.json',
      'multichain-cif': 'pxdesign-multichain-cif.json',
      multichain: 'pxdesign-multichain-cif.json',
    },
  },
  'esmfold2-pipeline': {
    defaultKey: 'default',
    files: {
      default: 'esmfold2-pipeline.json',
      miniprotein: 'esmfold2-pipeline.json',
      rcsb: 'esmfold2-rcsb.json',
      vhh: 'esmfold2-vhh.json',
      nanobody: 'esmfold2-vhh.json',
      scfv: 'esmfold2-scfv.json',
    },
  },
});

async function runExample(ctx, protocol) {
  if (ctx.flags.raw === true || ctx.flags.kind !== undefined) {
    throw usageError('schema: --example cannot be combined with --raw or --kind.');
  }
  const canonical = CANONICAL_PROTOCOL[protocol.trim().toLowerCase()] ?? protocol.trim().toLowerCase();
  const catalog = BUNDLED_EXAMPLES[canonical];
  const rawType = ctx.flags.example === true ? undefined : String(ctx.flags.example).trim().toLowerCase().replace(/_/g, '-');
  const available = catalog ? Object.keys(catalog.files) : [];

  let example = null;
  let resolvedType = rawType ?? catalog?.defaultKey ?? 'default';
  let source = 'bundled';
  let requestId;

  if (catalog) {
    const fileKey = rawType ?? catalog.defaultKey;
    const relPath = Object.prototype.hasOwnProperty.call(catalog.files, fileKey) ? catalog.files[fileKey] : null;
    if (relPath) {
      const absPath = join(EXAMPLES_ROOT, relPath);
      example = JSON.parse(fs.readFileSync(absPath, 'utf8'));
      resolvedType = fileKey;
    }
  }

  if (!example) {
    try {
      const res = await ctx.client.get(`/api/v1/protocols/${encodeURIComponent(protocol)}/example`, {
        query: rawType ? { project_type: rawType } : undefined,
        attempts: 1,
      });
      if (res.data && typeof res.data === 'object') {
        example = res.data.example ?? res.data;
        source = 'server';
        requestId = res.requestId;
      }
    } catch {
      // Fall through to usage error below.
    }
  }

  if (!example) {
    const hint = available.length
      ? ` Available examples for ${canonical}: ${available.join(', ')}.`
      : '';
    throw usageError(`schema: no starter example found for protocol "${protocol}"${rawType ? ` (project_type="${rawType}")` : ''}.${hint}`);
  }

  const outFile = ctx.flags.output || ctx.flags.o;
  if (outFile) {
    fs.writeFileSync(String(outFile), JSON.stringify(example, null, 2) + '\n');
    printProgress(`Example for "${canonical}" (${resolvedType}) written to ${outFile}`);
    if (ctx.json) {
      printJson({
        data: { protocol: canonical, project_type: resolvedType, output: String(outFile), source },
        ...(requestId ? { request_id: requestId } : {}),
      });
    }
    return;
  }
  if (ctx.json) {
    printJson({
      data: {
        protocol: canonical,
        project_type: resolvedType,
        example,
        ...(available.length ? { available_examples: available } : {}),
        source,
      },
      ...(requestId ? { request_id: requestId } : {}),
    });
    return;
  }
  printData(JSON.stringify(example, null, 2));
}

/** @param {{ client: any, flags: Record<string, any>, positionals: string[], json: boolean }} ctx */
export async function run(ctx) {
  const protocol = ctx.positionals[0];
  if (!protocol) {
    const err = new Error('Missing protocol id. Usage: ariax schema <protocol> [--example [TYPE]]');
    err.exitCode = EXIT.USAGE;
    throw err;
  }
  if (ctx.positionals.length !== 1) throw usageError('schema: expected one protocol id');
  const unknown = Object.keys(ctx.flags).find((name) => !['raw', 'kind', 'output', 'o', 'details', 'example'].includes(name));
  if (unknown) throw usageError(`schema: unknown flag --${unknown}`);
  if (ctx.flags.example !== undefined) {
    return runExample(ctx, protocol);
  }
  const kind = ctx.flags.kind || 'job';
  if (!['job', 'submission'].includes(kind)) throw usageError('schema: --kind must be job or submission');
  const raw = ctx.flags.raw === true;
  const details = ctx.flags.details === true;
  if (raw && details) throw usageError('schema: --raw and --details cannot be combined');
  const res = await ctx.client.get(`/api/v1/protocols/${encodeURIComponent(protocol)}/schema`, {
    auth: true, query: raw ? { format: 'raw', kind } : undefined,
  });
  let schema = res.data && typeof res.data === 'object' && 'schema' in res.data ? res.data.schema : res.data;
  if (!raw && !details && schema && typeof schema === 'object' && !Array.isArray(schema)) {
    const lean = { ...schema };
    if (kind !== 'submission' && Object.prototype.hasOwnProperty.call(lean, 'submission_schema')) {
      delete lean.submission_schema;
    }
    if (protocol.toLowerCase() !== 'boltzgen' && Object.prototype.hasOwnProperty.call(lean, 'binding_rule_schema')) {
      delete lean.binding_rule_schema;
    }
    schema = lean;
  }
  const outFile = ctx.flags.output || ctx.flags.o;
  if (outFile) {
    fs.writeFileSync(String(outFile), JSON.stringify(schema, null, 2) + '\n');
    printProgress(`Schema for "${protocol}" written to ${outFile}`);
    if (ctx.json) printJson({ data: { protocol, output: String(outFile) }, request_id: res.requestId });
    return;
  }
  if (raw) {
    printJson(schema);
    return;
  }
  if (ctx.json) {
    printJson({ data: schema, meta: res.meta, request_id: res.requestId });
    return;
  }
  printData(JSON.stringify(schema, null, 2));
}
