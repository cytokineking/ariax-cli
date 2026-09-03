#!/usr/bin/env node
/** Ariax CLI executable. Thin wrapper: exit code comes from src/main.js. */
import { main } from '../src/main.js';

const code = await main(process.argv.slice(2), process.env);
process.exitCode = code;
