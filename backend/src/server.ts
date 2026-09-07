import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'

dotenv.config()

const app = express()
const port = Number(process.env.PORT ?? 3000)
const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'

app.use(cors({ origin: frontendUrl }))
app.use(express.json())

app.get('/health', (_request, response) => {
    response.json({ status: 'ok', service: 'backend', timestamp: new Date().toISOString() })
})

app.listen(port, '127.0.0.1', () => {
    console.log(`API listening on http://127.0.0.1:${port}`)
})
