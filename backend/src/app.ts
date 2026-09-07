import cors from 'cors'
import express from 'express'
import { checkDatabase } from './db/client.js'
import { login, logout, register, requireAuth } from './auth.js'
import { getPrivateProfile, getPublicProfile, updatePrivacy, updateProfile } from './profiles.js'

export const createApp = () => {
    const app = express()
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'
    const allowedFrontendUrls = [...new Set([frontendUrl, 'http://localhost:5173', 'http://127.0.0.1:5173'])]

    app.use(cors({ origin: allowedFrontendUrls, credentials: true }))
    app.use(express.json({ limit: '16kb' }))

    app.get('/health', async (_request, response, next) => {
        try {
            const database = await checkDatabase()
            const status = database.status === 'ok' ? 'ok' : 'degraded'
            response.status(status === 'ok' ? 200 : 503).json({ status, service: 'backend', database, timestamp: new Date().toISOString() })
        } catch (error) { next(error) }
    })

    app.post('/api/auth/register', async (request, response, next) => {
        try {
            const result = await register(request.body ?? {}, response)
            response.status(result.status).json(result.body)
        } catch (error) { next(error) }
    })

    app.post('/api/auth/login', async (request, response, next) => {
        try {
            const result = await login(String(request.body?.username ?? ''), String(request.body?.password ?? ''), response)
            response.status(result.status).json(result.body)
        } catch (error) { next(error) }
    })

    app.post('/api/auth/logout', async (request, response, next) => {
        try { await logout(request, response); response.status(204).send() } catch (error) { next(error) }
    })

    app.get('/api/auth/me', requireAuth, (request, response) => response.json({ user: request.authUser }))

    app.get('/api/profiles/:username', async (request, response, next) => {
        try { const result = await getPublicProfile(request.params.username, request); response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.get('/api/profile/me', requireAuth, async (request, response, next) => {
        try { const result = await getPrivateProfile(request.authUser!); response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.patch('/api/profile/me', requireAuth, async (request, response, next) => {
        try { const result = await updateProfile(request.authUser!, request.body ?? {}); response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.patch('/api/profile/me/privacy', requireAuth, async (request, response, next) => {
        try { const result = await updatePrivacy(request.authUser!, request.body ?? {}); response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
        response.status(500).json({ error: 'INTERNAL_ERROR', message: 'Внутрішня помилка сервера' })
    })

    return app
}