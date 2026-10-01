import { MetadataDatabase } from '../src/server/storage/database';
const id = process.argv[2];
if (!id) throw new Error('Supply the target ID to revoke');
const database = new MetadataDatabase(process.env.HERDR_WEB_DATABASE ?? '.data/gateway.sqlite');
try { database.setSetting('validation:' + id, ''); console.log('Revoked the local capability evidence'); } finally { database.close(); }
