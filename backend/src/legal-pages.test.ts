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
