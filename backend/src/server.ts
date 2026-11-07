import dotenv from 'dotenv'
import { checkDatabase, closeDatabase } from './db/client.js'
import { createApp } from './app.js'
import { publishDueReviews } from './community-service.js'
import { dispatchPushBatch } from './web-push-service.js'

dotenv.config()

const port = Number(process.env.PORT ?? 3000)
const app = createApp()
const reviewTimer = setInterval(() => { publishDueReviews().catch(error => console.error('Review publication failed', error)) }, 60_000)
reviewTimer.unref()
let pushing = false
const pushTimer = setInterval(() => {
    if (pushing) return
    pushing = true
    void dispatchPushBatch().catch(() => console.error('Push batch failed')).finally(() => { pushing = false })
}, 5000)
pushTimer.unref()
void publishDueReviews().catch(error => console.error('Review publication failed', error))

const server = app.listen(port, '127.0.0.1', () => {
    console.log(`API listening on http://127.0.0.1:${port}`)
})

const shutdown = async () => {
    clearInterval(reviewTimer)
    clearInterval(pushTimer)
    server.close()
    await closeDatabase()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
