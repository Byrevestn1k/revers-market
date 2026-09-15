import cors from 'cors'
import express from 'express'
import { fileURLToPath } from 'node:url'
import { checkDatabase } from './db/client.js'
import { confirmEmail, login, logout, optionalAuth, register, resendVerification, requireAuth } from './auth.js'
import { confirmEmailCode, sendEmailCode } from './email-verification.js'
import { requestPasswordReset, resetPassword } from './password-reset.js'
import { changePassword } from './password-change.js'
import { getPrivateProfile, getPublicProfile, updatePrivacy, updateProfile } from './profiles.js'
import { createProduct, deleteProduct, getProduct, listCategories, listProducts, updateProduct } from './products.js'
import { acceptOffer, createBuyRequest, createOffer, getBuyRequest, listBuyRequests, listMyOffers, listOffers, rejectOffer, updateBuyRequest, updateOffer, withdrawOffer } from './buy-requests.js'
import { createMessage, getOrder, getOrderConversation, getOrderDeliveryAddress, getOrCreateOfferConversation, listMessages, listOrders, openDispute, resolveDispute, markConversationRead, updateOrderStatus } from './order-service.js'
import { blockUser, createReport, createReview, listConversations, listModerationReports, listNotifications, listReports, listReviews, markNotificationsRead, unblockUser, updateReportModeration } from './community-service.js'
import { adaptiveRadius, MapService } from './map-service.js'
import { confirmPhoneVerification, sendPhoneVerification } from './phone-verification.js'

const mapService = new MapService()

type HandlerResult = { status: number; body?: unknown }
type RequestHandler = (request: express.Request, response: express.Response) => Promise<HandlerResult>

const withResult = (handler: RequestHandler) =>
    async (request: express.Request, response: express.Response, next: express.NextFunction) => {
        try {
            const result = await handler(request, response)
            if (result.status === 204) response.status(204).send()
            else response.status(result.status).json(result.body)
        } catch (error) { next(error) }
    }

export const createApp = () => {
    const app = express()
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'
    const allowedFrontendUrls = [...new Set([frontendUrl, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'])]

    app.use(cors({ origin: allowedFrontendUrls, credentials: true }))
    app.use(express.json({ limit: '8mb' }))
    app.use('/uploads', express.static(fileURLToPath(new URL('../uploads', import.meta.url))))

    app.get('/health', withResult(async () => {
        const database = await checkDatabase()
        const status = database.status === 'ok' ? 'ok' : 'degraded'
        return { status: status === 'ok' ? 200 : 503, body: { status, service: 'backend', database, timestamp: new Date().toISOString() } }
    }))

    app.post('/api/auth/register', withResult((request, response) => register(request.body ?? {}, response)))

    app.post('/api/auth/login', withResult((request, response) => login(String(request.body?.username ?? ''), String(request.body?.password ?? ''), response)))
    app.post('/api/auth/password-reset/request', withResult((request) => requestPasswordReset(String(request.body?.identifier ?? ''))))
    app.post('/api/auth/password-reset/confirm', withResult((request) => resetPassword(String(request.body?.identifier ?? ''), String(request.body?.code ?? ''), String(request.body?.password ?? ''))))
    app.post('/api/profile/me/password', requireAuth, withResult((request) => changePassword(request.authUser!.id, String(request.body?.currentPassword ?? ''), String(request.body?.newPassword ?? ''), String(request.body?.confirmation ?? ''))))

    app.post('/api/auth/resend-verification', requireAuth, withResult((request) => resendVerification(request.authUser!)))

    app.post(['/api/auth/confirm-email', '/api/auth/verify-email'], withResult((request) => confirmEmail(String(request.body?.token ?? ''))))
    app.post('/api/profile/me/email-verification', requireAuth, withResult(async (request) => ({ status: 200, body: await sendEmailCode(request.authUser!.id, String(request.body?.email ?? request.authUser!.email ?? '')) })))
    app.post('/api/profile/me/email-verification/confirm', requireAuth, withResult(async (request) => ({ status: (await confirmEmailCode(request.authUser!.id, String(request.body?.code ?? ''))).ok ? 200 : 400, body: { ok: true } })))

    app.post('/api/auth/logout', withResult(async (request, response) => { await logout(request, response); return { status: 204 } }))

    app.get('/api/auth/me', requireAuth, (request, response) => response.json({ user: request.authUser }))

    app.get('/api/profiles/:username', withResult((request) => getPublicProfile(String(request.params.username), request)))

    app.get('/api/profiles/:username/reviews', withResult((request) => listReviews(String(request.params.username))))

    app.get('/api/profile/me', requireAuth, withResult((request) => getPrivateProfile(request.authUser!)))

    app.patch('/api/profile/me', requireAuth, withResult((request) => updateProfile(request.authUser!, request.body ?? {})))

    app.patch('/api/profile/me/privacy', requireAuth, withResult((request) => updatePrivacy(request.authUser!, request.body ?? {})))
    app.post('/api/profile/me/phone-verification', requireAuth, withResult(async (request) => ({ status: 200, body: await sendPhoneVerification(request.authUser!.id, String(request.body?.phone ?? request.authUser!.phone)) })))
    app.post('/api/profile/me/phone-verification/confirm', requireAuth, withResult(async (request) => ({ status: (await confirmPhoneVerification(request.authUser!.id, String(request.body?.code ?? ''))).ok ? 200 : 400, body: { ok: true } })))

    app.get('/api/categories', withResult(() => listCategories()))

    app.get('/api/map/markers', withResult(async (request) => {
        const latitude = Number(request.query.latitude)
        const longitude = Number(request.query.longitude)
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
            return { status: 400, body: { error: 'INVALID_MAP_CENTER' } }
        }
        const radiusKm = adaptiveRadius(request.query.radiusKm as string | undefined, request.query.zoom as string | undefined)
        const showProducts = request.query.showProducts !== 'false'
        const showBuyRequests = request.query.showBuyRequests !== 'false'
        const markers = await mapService.findMarkers({ latitude, longitude }, {
            categoryId: typeof request.query.categoryId === 'string' ? request.query.categoryId : undefined,
            geoZone: typeof request.query.geoZone === 'string' ? request.query.geoZone : undefined,
            radiusKm,
            showProducts,
            showBuyRequests,
        })
        return { status: 200, body: { markers, filters: { radiusKm, showProducts, showBuyRequests } } }
    }))

    app.get('/api/products', withResult((request) => listProducts(request.query, request.authUser)))

    app.get('/api/products/mine', requireAuth, withResult((request) => listProducts({ ...request.query, mine: 'true' }, request.authUser)))

    app.get('/api/products/:id', withResult((request) => getProduct(String(request.params.id), request.authUser)))

    app.post('/api/products', requireAuth, withResult((request) => createProduct(request.authUser!, request.body ?? {})))

    app.patch('/api/products/:id', requireAuth, withResult((request) => updateProduct(request.authUser!, String(request.params.id), request.body ?? {})))

    app.delete('/api/products/:id', requireAuth, withResult((request) => deleteProduct(request.authUser!, String(request.params.id))))

    app.get('/api/buy-requests', optionalAuth, withResult((request) => listBuyRequests(request.query, request.authUser)))

    app.get('/api/buy-requests/:id', optionalAuth, withResult((request) => getBuyRequest(String(request.params.id), request.authUser)))

    app.post('/api/buy-requests', requireAuth, withResult((request) => createBuyRequest(request.authUser!, request.body ?? {})))

    app.patch('/api/buy-requests/:id', requireAuth, withResult((request) => updateBuyRequest(request.authUser!, String(request.params.id), request.body ?? {})))

    app.get('/api/buy-requests/:id/offers', requireAuth, withResult((request) => listOffers(request.authUser!, String(request.params.id))))

    app.post('/api/buy-requests/:id/offers', requireAuth, withResult((request) => createOffer(request.authUser!, String(request.params.id), request.body ?? {})))

    app.post('/api/offers/:id/accept', requireAuth, withResult((request) => acceptOffer(request.authUser!, String(request.params.id), request.body ?? {})))

    app.post('/api/offers/:id/conversation', requireAuth, withResult((request) => getOrCreateOfferConversation(request.authUser!, String(request.params.id))))

    app.patch('/api/offers/:id', requireAuth, withResult((request) => updateOffer(request.authUser!, String(request.params.id), request.body ?? {})))

    app.delete('/api/offers/:id', requireAuth, withResult((request) => withdrawOffer(request.authUser!, String(request.params.id))))

    app.post('/api/offers/:id/reject', requireAuth, withResult((request) => rejectOffer(request.authUser!, String(request.params.id))))

    app.get('/api/offers/mine', requireAuth, withResult((request) => listMyOffers(request.authUser!)))

    app.get('/api/orders', requireAuth, withResult((request) => listOrders(request.authUser!)))

    app.get('/api/orders/:id', requireAuth, withResult((request) => getOrder(request.authUser!, String(request.params.id))))

    app.get('/api/orders/:id/delivery-address', requireAuth, withResult((request) => getOrderDeliveryAddress(request.authUser!, String(request.params.id))))

    app.patch('/api/orders/:id/status', requireAuth, withResult((request) => updateOrderStatus(request.authUser!, String(request.params.id), request.body?.status, request.body?.reason)))

    app.post('/api/orders/:id/dispute', requireAuth, withResult((request) => openDispute(request.authUser!, String(request.params.id), request.body?.reason)))

    app.post('/api/orders/:id/dispute/resolve', requireAuth, withResult((request) => resolveDispute(request.authUser!, String(request.params.id), request.body?.outcome, request.body?.resolution)))

    app.get('/api/orders/:id/conversation', requireAuth, withResult((request) => getOrderConversation(request.authUser!, String(request.params.id))))

    app.get('/api/conversations/:id/messages', requireAuth, withResult((request) => listMessages(request.authUser!, String(request.params.id))))

    app.post('/api/conversations/:id/messages', requireAuth, withResult((request) => createMessage(request.authUser!, String(request.params.id), request.body?.body)))

    app.patch('/api/conversations/:id/read', requireAuth, withResult((request) => markConversationRead(request.authUser!, String(request.params.id))))

    app.get('/api/conversations', requireAuth, withResult((request) => listConversations(request.authUser!)))

    app.get('/api/notifications', requireAuth, withResult((request) => listNotifications(request.authUser!)))

    app.patch('/api/notifications/read', requireAuth, withResult((request) => markNotificationsRead(request.authUser!, typeof request.body?.notificationId === 'string' ? request.body.notificationId : undefined)))

    app.post('/api/orders/:id/reviews', requireAuth, withResult((request) => createReview(request.authUser!, String(request.params.id), request.body ?? {})))

    app.post('/api/reports', requireAuth, withResult((request) => createReport(request.authUser!, request.body ?? {})))

    app.get('/api/reports/mine', requireAuth, withResult((request) => listReports(request.authUser!)))

    app.get('/api/moderation/reports', requireAuth, withResult((request) => listModerationReports(request.authUser!)))

    app.patch('/api/moderation/reports/:id', requireAuth, withResult((request) => updateReportModeration(request.authUser!, String(request.params.id), request.body?.status, request.body?.note)))

    app.post('/api/users/:id/block', requireAuth, withResult((request) => blockUser(request.authUser!, String(request.params.id))))

    app.delete('/api/users/:id/block', requireAuth, withResult((request) => unblockUser(request.authUser!, String(request.params.id))))

    app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
        console.error('[app] unhandled error:', error)
        response.status(500).json({ error: 'INTERNAL_ERROR', message: 'Внутрішня помилка сервера' })
    })

    return app
}
