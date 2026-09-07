import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { checkDatabase, closeDatabase } from './db/client.js'

dotenv.config()

const app = express()
const port = Number(process.env.PORT ?? 3000)
const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'

app.use(cors({ origin: frontendUrl }))
app.use(express.json())

app.get('/health', async (_request, response) => {
    const database = await checkDatabase()
    const status = database.status === 'ok' ? 'ok' : 'degraded'

    response.status(status === 'ok' ? 200 : 503).json({
        status,
        service: 'backend',
        database,
        timestamp: new Date().toISOString(),
    })
})

const server = app.listen(port, '127.0.0.1', () => {
    console.log(`API listening on http://127.0.0.1:${port}`)
})

const shutdown = async () => {
    server.close()
    await closeDatabase()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
