// Local QA only: use the real Express app against the isolated Step 32 database.
import dotenv from 'dotenv'
dotenv.config()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const database = new URL(process.env.DATABASE_URL)
database.pathname = '/navpaky_step32_qa'
process.env.DATABASE_URL = database.toString()
async function start() {
    const { createApp } = await import('../../../backend/src/app.js')
    const { closeDatabase } = await import('../../../backend/src/db/client.js')
    const server = createApp().listen(3399, '127.0.0.1', () => console.log('Isolated QA API listening on 3399'))
    process.once('SIGINT', () => server.close(() => { void closeDatabase().finally(() => process.exit(0)) }))
}
void start()
