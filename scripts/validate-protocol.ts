import { boundedProcess } from '../src/server/transport/process';
import { validateInstalledSchema } from '../src/server/protocol/validate';
import { readFile } from 'node:fs/promises';

const path = process.argv[2];
const schema = JSON.parse(path ? await readFile(path, 'utf8') : await boundedProcess('herdr', ['api', 'schema', '--json'], undefined, 5000, 2 * 1024 * 1024));
const errors = validateInstalledSchema(schema);
if (errors.length) { for (const error of errors) console.error(error); process.exitCode = 1; }
else {
  console.log('PASS: installed JSON API protocol 22, required methods, subscriptions and terminal identity fields');
  console.log('NOT PROVED: the schema does not export terminal CLI frames or keyboard modes; live stream/control proof remains required');
}
