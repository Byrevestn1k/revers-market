import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import request from 'supertest'

const db = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('./db/client.js', () => ({ pool: db, checkDatabase: vi.fn() }))
vi.mock('./community-service.js', async importOriginal => ({
  ...await importOriginal<typeof import('./community-service.js')>(), publishDueReviews: vi.fn(),
}))
import { createApp } from './app.js'

describe('profile API optional authentication and phone privacy', () => {
  const app = createApp()
  const hash = (token: string) => createHash('sha256').update(token).digest('hex')
  beforeEach(() => { db.query.mockReset() })
  for (const visibility of ['private', 'authenticated', 'public']) {
    for (const consent of [false, true]) {
      it.each(['guest', 'valid', 'expired', 'revoked'])(`${visibility}, consent=${consent}, viewer=%s`, async viewer => {
        db.query.mockImplementation(async (sql: string, values: unknown[]) => {
          if (sql.includes('FROM user_sessions')) {
            expect(sql).toContain('s.revoked_at IS NULL')
            expect(sql).toContain('s.expires_at > now()')
            return values[0] === hash('valid') ? { rowCount: 1, rows: [{ id: 'viewer', username: 'viewer', auth_session_id: 'session' }] } : { rowCount: 0, rows: [] }
          }
          if (sql.startsWith('UPDATE users SET last_seen_at')) return { rowCount: 0, rows: [] }
          if (sql.includes('WHERE username_normalized')) return { rowCount: 1, rows: [{
            id: 'seller', username: 'seller', phone: '+380501234567', phone_visibility: visibility,
            phone_disclosure_consent: consent, email: 'private@example.invalid', recovery_email: 'recovery@example.invalid',
            exact_address: 'PRIVATE HOME ADDRESS', map_location_mode: 'approximate', created_at: new Date('2026-01-01'),
          }] }
          throw new Error('Unexpected database operation in profile route test')
        })
        const call = request(app).get('/api/profiles/seller')
        if (viewer !== 'guest') call.set('Cookie', `navpaky_session=${viewer}`)
        const response = await call
        expect(response.status).toBe(200)
        expect(response.headers['cache-control']).toBe('no-store')
        const allowed = consent && (visibility === 'public' || visibility === 'authenticated' && viewer === 'valid')
        expect(response.body.profile.phone).toBe(allowed ? '+380501234567' : null)
        expect(response.text).not.toContain('private@example.invalid')
        expect(response.text).not.toContain('recovery@example.invalid')
        expect(response.text).not.toContain('PRIVATE HOME ADDRESS')
      })
    }
  }
})
