import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import { EXIT } from './exit-codes.js';
import { hasCifProteinAtoms } from './structure-input.js';

export const MAX_INPUT_SIZE = 10 * 1024 * 1024;

function invalid(message) {
  const error = new Error(message);
  error.code = 'validation_failed';
  error.exitCode = EXIT.VALIDATION;
  return error;
}

export function readAndValidateInput(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    throw invalid(`Cannot read input file "${filePath}": ${error.message}`);
  }
  if (!stat.isFile()) throw invalid(`Input path is not a file: "${filePath}".`);
  if (stat.size === 0) throw invalid('Input structure is empty.');
  if (stat.size > MAX_INPUT_SIZE) throw invalid('Input structure exceeds the 10 MB limit.');

  return validateInputBytes(fs.readFileSync(filePath), filePath);
}

/** Apply the same bounded content checks to local files and public RCSB downloads. */
export function validateInputBytes(body, filename) {
  if (!Buffer.isBuffer(body)) body = Buffer.from(body);
  if (!body.length) throw invalid('Input structure is empty.');
  if (body.length > MAX_INPUT_SIZE) throw invalid('Input structure exceeds the 10 MB limit.');
  const extension = path.extname(filename).toLowerCase();
  const targetFilename = extension === '.pdb'
    ? 'input.pdb'
    : (extension === '.cif' || extension === '.mmcif' ? 'input.cif' : null);
  if (!targetFilename) throw invalid('Input structure must be a .pdb, .cif, or .mmcif file.');

  if (body.includes(0)) throw invalid('Input structure must be UTF-8 text.');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw invalid('Input structure must be UTF-8 text.');
  }

  const hasAtoms = targetFilename === 'input.pdb'
    ? text.split(/\r?\n/).some((line) => line.startsWith('ATOM  '))
    : hasCifProteinAtoms(text);
  if (!hasAtoms) throw invalid('Input structure does not contain recognizable protein atoms.');

  return { body, text, targetFilename };
}
