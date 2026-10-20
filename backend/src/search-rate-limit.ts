import type { RequestHandler } from 'express';

type Entry = { count: number; resetAt: number };

export function createSearchRateLimiter(options: { max?: number; windowMs?: number; maxKeys?: number } = {}): RequestHandler {
  const max = options.max ?? 120;
  const windowMs = options.windowMs ?? 60_000;
  const maxKeys = options.maxKeys ?? 10_000;
  const entries = new Map<string, Entry>();
  let lastSweep = 0;

  return (request, response, next) => {
    if (typeof request.query.q !== 'string' || !request.query.q.trim()) { next(); return; }
    const now = Date.now();
    if (now - lastSweep >= windowMs || entries.size >= maxKeys) {
      for (const [key, entry] of entries) if (entry.resetAt <= now) entries.delete(key);
      lastSweep = now;
    }
    // The socket address cannot be changed with an untrusted forwarded header.
    const key = request.socket.remoteAddress ?? 'unknown';
    let entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
      if (entries.size >= maxKeys && !entries.has(key)) {
        response.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
        response.status(429).json({ error: 'SEARCH_RATE_LIMIT', message: 'Забагато пошукових запитів. Спробуйте трохи пізніше.' });
        return;
      }
      entry = { count: 0, resetAt: now + windowMs };
      entries.set(key, entry);
    }
    if (entry.count >= max) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      response.status(429).json({ error: 'SEARCH_RATE_LIMIT', message: 'Забагато пошукових запитів. Спробуйте трохи пізніше.' });
      return;
    }
    entry.count++;
    next();
  };
}
