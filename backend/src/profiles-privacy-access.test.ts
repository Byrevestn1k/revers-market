import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Request } from 'express'

const mocks = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('./db/client.js', () => ({ pool: { query: mocks.query } }))
vi.mock('./community-service.js', () => ({ publishDueReviews: vi.fn() }))
import { getPublicProfile } from './profiles.js'

describe('authenticated profile phone disclosure', () => {
  beforeEach(() => mocks.query.mockReset())
  it.each([
    [false, true, null],
    [true, false, null],
    [true, true, '+380501234567'],
  ])('requires disclosure consent (%s) and a signed-in viewer (%s)', async (consent, signedIn, expected) => {
    mocks.query.mockResolvedValue({ rows: [{
      id: 'seller', username: 'seller', phone: '+380501234567',
      phone_visibility: 'authenticated', phone_disclosure_consent: consent,
      created_at: new Date('2026-01-01'),
    }] })
    const request = { query: {}, ...(signedIn ? { authUser: { id: 'viewer' } } : {}) } as unknown as Request
    const result = await getPublicProfile('seller', request)
    expect(result.status).toBe(200)
    expect('profile' in result.body && result.body.profile?.phone).toBe(expected)
  })
})
