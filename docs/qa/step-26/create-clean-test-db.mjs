import { Client } from 'pg'

const url = 'postgresql://step26_test:step26_test@127.0.0.1:55433/step26_test'
if (process.env.DATABASE_URL !== url) throw new Error('Only the isolated Step 26 server is allowed')
const client = new Client({ connectionString: url })
await client.connect()
try {
  if ((await client.query("SELECT 1 FROM pg_database WHERE datname='step26_clean_final'")).rowCount) throw new Error('Test database already exists; refusing to overwrite it')
  await client.query('CREATE DATABASE step26_clean_final')
  console.log('Created empty isolated database step26_clean_final')
} finally { await client.end() }
