import { afterEach, expect, it } from 'vitest'
import { createECDH, randomBytes } from 'node:crypto'
import * as webpush from 'web-push'
import { pushConfig } from './web-push-service.js'

const previous = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT }
afterEach(() => {
    for (const [key, value] of Object.entries({ VAPID_PUBLIC_KEY: previous.publicKey, VAPID_PRIVATE_KEY: previous.privateKey, VAPID_SUBJECT: previous.subject })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
})

it('loads the actual Web Push module and prepares an encrypted request', () => {
    const keys = webpush.generateVAPIDKeys()
    process.env.VAPID_PUBLIC_KEY = keys.publicKey
    process.env.VAPID_PRIVATE_KEY = keys.privateKey
    process.env.VAPID_SUBJECT = 'mailto:test@example.invalid'
    expect(pushConfig()).toEqual({ publicKey: keys.publicKey })
    const recipient = createECDH('prime256v1'); recipient.generateKeys()
    const request = webpush.generateRequestDetails({ endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: recipient.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }, 'тест')
    expect(request.headers.Authorization).toMatch(/^vapid /)
    expect(request.headers['Content-Encoding']).toBe('aes128gcm')
    expect(request.body).toBeInstanceOf(Buffer)
})
