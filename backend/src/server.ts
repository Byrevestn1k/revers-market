import dotenv from 'dotenv'
import { checkDatabase, closeDatabase } from './db/client.js'
import { createApp } from './app.js'

dotenv.config()

const port = Number(process.env.PORT ?? 3000)
const app = createApp()

const server = app.listen(port, '127.0.0.1', () => {
    console.log(`API listening on http://127.0.0.1:${port}`)
})

const shutdown = async () => {
    server.close()
    await closeDatabase()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
