import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('./db/client.js', () => ({ pool: { query } }))
import { createEmailVerification, verifyEmailToken } from './email-verification.js'

describe('email verification', () => {
    beforeEach(() => query.mockReset())
    it('stores only a hash and atomically limits resends', async () => {
        query.mockResolvedValue({ rowCount: 1 })
        const token = await createEmailVerification('id', 'Test@example.com')
        const [sql, values] = query.mock.calls[0]
        expect(values[2]).toBe(createHash('sha256').update(token).digest('hex'))
        expect(values[2]).not.toBe(token)
        expect(sql).toContain("interval '23 hours 59 minutes'")
        query.mockResolvedValue({ rowCount: 0 })
        await expect(createEmailVerification('id', 'Test@example.com')).rejects.toThrow()
    })
    it('consumes a valid token once and rejects expired or reused tokens', async () => {
        query.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValue({ rowCount: 0 })
        expect(await verifyEmailToken('secret')).toEqual({ ok: true })
        expect(query.mock.calls[0][0]).toContain('email_verification_expires > now()')
        expect(query.mock.calls[0][0]).toContain('email_verification_token = NULL')
        expect(await verifyEmailToken('secret')).toEqual({ ok: false })
    })
})
