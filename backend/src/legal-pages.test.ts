import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const db = vi.hoisted(() => ({ query: vi.fn(() => { throw new Error('Legal pages must not query a database') }), connect: vi.fn(() => { throw new Error('Legal pages must not connect to a database') }) }))
vi.mock('./db/client.js', () => ({ pool: db, checkDatabase: vi.fn() }))
import { createApp } from './app.js'

describe('public legal document entry routes', () => {
  const app = createApp()
  it.each(['about', 'terms', 'privacy', 'cookies', 'listing-rules', 'prohibited', 'safety', 'contacts'])('serves /legal/%s without authentication or database access', async slug => {
    for (const suffix of ['', '/']) {
      const response = await request(app).get(`/legal/${slug}${suffix}`)
      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toContain('text/html')
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.headers['x-robots-tag']).toBe('noindex, nofollow')
      expect(response.headers['set-cookie']).toBeUndefined()
      expect(response.text).toContain('<div id="root">')
    }
    expect(db.query).not.toHaveBeenCalled()
    expect(db.connect).not.toHaveBeenCalled()
  })
})

describe('explicit SPA entry routes', () => {
  const app = createApp()
  it.each([
    '/dashboard', '/discover', '/products', '/map', '/requests',
    '/my/products', '/my/products/new', '/my/products/example/edit', '/my/requests', '/my/requests/new',
    '/favorites', '/messages', '/messages/example', '/cabinet', '/orders', '/notifications',
    '/settings/profile', '/settings/demand-subscriptions',
    '/auth/login', '/auth/register', '/auth/external/finish', '/verify-email',
  ])('serves %s directly without reading private data', async path => {
    const response = await request(app).get(path + '?from=mobile')
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(db.query).not.toHaveBeenCalled()
    expect(db.connect).not.toHaveBeenCalled()
  })
  it.each(['/api/not-a-route', '/assets/not-a-file.js', '/not-a-route', '/settings/not-a-route', '/auth/not-a-route', '/products/not-a-uuid', '/buy-requests/not-a-uuid'])('keeps unavailable API, asset and share URLs as 404: %s', async path => {
    const response = await request(app).get(path)
    expect(response.status).toBe(404)
    expect(response.text).not.toContain('<div id="root">')
    expect(db.query).not.toHaveBeenCalled()
  })
  it('does not apply the GET shell fallback to mutations', async () => {
    expect((await request(app).post('/discover')).status).toBe(404)
  })
})
