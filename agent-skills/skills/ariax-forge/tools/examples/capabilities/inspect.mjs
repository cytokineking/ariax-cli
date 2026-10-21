import { readFileSync } from 'node:fs';
const [filename, task] = process.argv.slice(2);
if (!filename || !['binder-design', 'antibodies', 'molecular-prediction', 'sequence-optimization', 'validation-search'].includes(task)) {
  throw new Error('Usage: node inspect.mjs catalog.json TASK');
}
const response = JSON.parse(readFileSync(filename, 'utf8'));
const tools = response.data?.tools;
if (!Array.isArray(tools)) throw new Error('Expected the public catalog data.tools array');
console.log(JSON.stringify({ tools: tools.filter(tool => tool.capabilities?.tasks?.includes(task)) }, null, 2));
