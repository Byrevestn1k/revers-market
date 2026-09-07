import cors from 'cors'
import express from 'express'
import { fileURLToPath } from 'node:url'
import { checkDatabase } from './db/client.js'
import { login, logout, register, requireAuth } from './auth.js'
import { getPrivateProfile, getPublicProfile, updatePrivacy, updateProfile } from './profiles.js'
import { createProduct, deleteProduct, getProduct, listCategories, listProducts, updateProduct } from './products.js'
import { acceptOffer, createBuyRequest, createOffer, getBuyRequest, listBuyRequests, listOffers, updateBuyRequest } from './buy-requests.js'

export const createApp = () => {
    const app = express()
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'
    const allowedFrontendUrls = [...new Set([frontendUrl, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'])]

    app.use(cors({ origin: allowedFrontendUrls, credentials: true }))
    app.use(express.json({ limit: '8mb' }))
    app.use('/uploads', express.static(fileURLToPath(new URL('../uploads', import.meta.url))))

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

    app.get('/api/categories', async (_request, response, next) => {
        try { const result = await listCategories(); response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.get('/api/products', async (request, response, next) => {
        try { const result = await listProducts(request.query, request.authUser); response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.get('/api/products/mine', requireAuth, async (request, response, next) => {
        try { const result = await listProducts({ ...request.query, mine: 'true' }, request.authUser); response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.get('/api/products/:id', async (request, response, next) => {
        try { const result = await getProduct(request.params.id, request.authUser); response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.post('/api/products', requireAuth, async (request, response, next) => {
        try { const result = await createProduct(request.authUser!, request.body ?? {}); response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.patch('/api/products/:id', requireAuth, async (request, response, next) => {
        try { const result = await updateProduct(request.authUser!, String(request.params.id), request.body ?? {}); response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.delete('/api/products/:id', requireAuth, async (request, response, next) => {
        try { const result = await deleteProduct(request.authUser!, String(request.params.id)); if (result.status === 204) response.status(204).send(); else response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.get('/api/buy-requests', async (request, response, next) => {
        try { const result = await listBuyRequests(request.query, request.authUser); response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.get('/api/buy-requests/:id', async (request, response, next) => {
        try { const result = await getBuyRequest(String(request.params.id), request.authUser); response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.post('/api/buy-requests', requireAuth, async (request, response, next) => {
        try { const result = await createBuyRequest(request.authUser!, request.body ?? {}); response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.patch('/api/buy-requests/:id', requireAuth, async (request, response, next) => {
        try { const result = await updateBuyRequest(request.authUser!, String(request.params.id), request.body ?? {}); response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.get('/api/buy-requests/:id/offers', requireAuth, async (request, response, next) => {
        try { const result = await listOffers(request.authUser!, String(request.params.id)); response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.post('/api/buy-requests/:id/offers', requireAuth, async (request, response, next) => {
        try { const result = await createOffer(request.authUser!, String(request.params.id), request.body ?? {}); response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.post('/api/offers/:id/accept', requireAuth, async (request, response, next) => {
        try { const result = await acceptOffer(request.authUser!, String(request.params.id), request.body ?? {}); response.status(result.status).json(result.body) } catch (error) { next(error) }
    })

    app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
        response.status(500).json({ error: 'INTERNAL_ERROR', message: 'Внутрішня помилка сервера' })
    })

    return app
}