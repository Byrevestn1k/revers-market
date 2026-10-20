import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createSearchRateLimiter } from './search-rate-limit.js';

describe('public text search rate limit', () => {
  it('returns 429 after the search allowance and ignores a forged forwarded address', async () => {
    const app = express();
    app.get('/search', createSearchRateLimiter({ max: 2 }), (_request, response) => response.json({ ok: true }));
    expect((await request(app).get('/search?q=велосипед').set('X-Forwarded-For', '1.1.1.1')).status).toBe(200);
    expect((await request(app).get('/search?q=велосипед').set('X-Forwarded-For', '2.2.2.2')).status).toBe(200);
    const blocked = await request(app).get('/search?q=велосипед').set('X-Forwarded-For', '3.3.3.3');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('SEARCH_RATE_LIMIT');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await request(app).get('/search')).status).toBe(200);
  });
});
