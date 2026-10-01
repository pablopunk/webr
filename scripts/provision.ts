import { getMigrations } from 'better-auth/db/migration';
import { MetadataDatabase } from '../src/server/storage/database';
import { createAuth } from '../src/server/auth';

const email = process.env.HERDR_WEB_EMAIL;
const password = process.env.HERDR_WEB_PASSWORD;
if (!email || !password || password.length < 16) throw new Error('Set HERDR_WEB_EMAIL and HERDR_WEB_PASSWORD (at least 16 characters) locally');
const database = new MetadataDatabase(process.env.HERDR_WEB_DATABASE ?? '.data/gateway.sqlite');
try {
  if (database.getSetting('allowed_account')) throw new Error('An allowed account already exists; provisioning does not replace it');
  const { auth } = createAuth(database, process.env.HERDR_WEB_ORIGIN ?? 'http://127.0.0.1:4321', process.env.BETTER_AUTH_SECRET ?? '', true);
  const migrations = await getMigrations(auth.options);
  await migrations.runMigrations();
  const result = await auth.api.signUpEmail({ body: { email, password, name: 'Owner' } });
  database.setSetting('allowed_account', result.user.id);
  console.log('The allowed local account is provisioned; public signup is disabled');
} finally { database.close(); }
