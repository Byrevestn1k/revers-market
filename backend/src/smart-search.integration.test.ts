import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { searchSettlements } from './settlements.js';

if (process.env.DATABASE_URL) {
  const { createApp } = await import('./app.js');
  const { pool } = await import('./db/client.js');

  describe('smart search with PostgreSQL', () => {
    it('ranks complete matches, preserves filters and updates on edit for both listing types and the map', async () => {
      const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const username = `search_${suffix}`;
      const app = createApp();
      const agent = request.agent(app);
      try {
        expect((await agent.post('/api/auth/register').send({ username, email: `${username}@example.com`, countryCode: 'UA', phone: '+38050' + suffix.slice(-7), password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })).status).toBe(201);
        const category = (await agent.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains');
        const categoryId = category.id;
        const rivne = searchSettlements('Рівне').settlements.find(item => item.name === 'Рівне' && item.region === 'Рівненська область')!;
        const base = { categoryId, quantity: 1, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', status: 'active', geoZone: rivne.name, settlementCode: rivne.code, latitude: 50.6199, longitude: 26.2516 };
        const ids: string[] = [];
        for (const item of [
          { title: 'Trek', description: 'Червоний дитячий велосипед' },
          { title: 'Велосипед', description: 'Лише один збіг' },
          { title: 'Червоний дитячий велосипед', description: 'Повний збіг у назві' },
          { title: 'Дитячий Trek', description: 'Червоний велосипед' },
        ]) {
          const created = await agent.post('/api/products').send({ ...base, ...item });
          expect(created.status).toBe(201);
          ids.push(created.body.product.id);
        }
        const list = async (q: string, extra: Record<string, string> = {}) => (await agent.get('/api/products').query({ q, ownerUsername: username, ...extra })).body;
        const ranked = await list('червоний дитячий велосипед');
        expect(ranked.products.map((item: { id: string }) => item.id)).toEqual([ids[2], ids[3], ids[0]]);
        expect((await list('велосипед дитячий')).products.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([ids[0], ids[2], ids[3]]));
        expect((await list('велосепед дитячий')).products.map((item: { id: string }) => item.id)).toContain(ids[0]);
        expect((await list('велосепед')).products.map((item: { id: string }) => item.id)).toContain(ids[0]);
        expect((await list('детский велосипед')).products.map((item: { id: string }) => item.id)).toContain(ids[0]);
        expect((await list('велоси')).products.map((item: { id: string }) => item.id)).toContain(ids[2]);
        expect((await list(category.name)).products.map((item: { id: string }) => item.id)).toContain(ids[0]);
        expect((await list('несуществующий товар xyz')).products).toEqual([]);
        expect((await list('червоний дитячий велосипед', { limit: '1', page: '2' })).pagination).toMatchObject({ total: 3, pages: 3 });
        expect((await list('червоний дитячий велосипед', { geoZone: 'невідоме' })).products).toEqual([]);
        const model23 = await agent.post('/api/products').send({ ...base, title: 'Samsung Galaxy S23 Ultra', description: 'Смартфон' });
        const model24 = await agent.post('/api/products').send({ ...base, title: 'Samsung Galaxy S24 Ultra', description: 'Смартфон' });
        expect(model23.status).toBe(201);
        expect(model24.status).toBe(201);
        expect((await list('Samsung Galaxy S23')).products[0].id).toBe(model23.body.product.id);
        expect((await list('S23')).products.map((item: { id: string }) => item.id)).toEqual([model23.body.product.id]);
        expect((await list('самсунг')).products.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([model23.body.product.id, model24.body.product.id]));
        const pump = await agent.post('/api/products').send({ ...base, title: 'Насос', description: 'Для води 12В' });
        const wrongVoltage = await agent.post('/api/products').send({ ...base, title: 'Насос', description: 'Для води 220В' });
        expect(pump.status).toBe(201);
        expect(wrongVoltage.status).toBe(201);
        expect((await list('насос для води 12 В')).products.map((item: { id: string }) => item.id)).toEqual([pump.body.product.id]);
        expect((await list('насос для води 12v')).products.map((item: { id: string }) => item.id)).toEqual([pump.body.product.id]);

        const buy = await agent.post('/api/buy-requests').send({ categoryId, title: 'Шукаю велосипед', description: 'Червоний дитячий Trek', quantity: 1, unit: 'kg', currency: 'UAH', countryCode: 'UA', geoArea: rivne.name, settlementCode: rivne.code, latitude: 50.6199, longitude: 26.2516 });
        expect(buy.status).toBe(201);
        const requestId = buy.body.buyRequest.id;
        const requests = await agent.get('/api/buy-requests').query({ q: 'червоний дитячий велосипед', buyerUsername: username });
        expect(requests.body.buyRequests.map((item: { id: string }) => item.id)).toContain(requestId);
        expect((await agent.get('/api/buy-requests').query({ q: 'велосепед дитячий', buyerUsername: username, limit: 1 })).body.pagination).toMatchObject({ page: 1, limit: 1, total: 1 });
        expect((await agent.get('/api/buy-requests').query({ q: 'велосепед дитячий', buyerUsername: username, excludeMine: 'true', limit: 1 })).body).toMatchObject({ buyRequests: [], pagination: { page: 1, limit: 1, total: 0, pages: 0 } });
        expect((await agent.get('/api/buy-requests').query({ q: username, searchIn: 'owner', buyerUsername: username })).body.buyRequests.map((item: { id: string }) => item.id)).toContain(requestId);
        const map = await agent.get('/api/map/markers').query({ latitude: 50.62, longitude: 26.25, radiusKm: 10, q: 'червоний дитячий велосипед', searchIn: 'all' });
        expect(map.status).toBe(200);
        expect(map.body.markers.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([ids[0], ids[2], requestId]));

        expect((await agent.patch(`/api/products/${ids[0]}`).send({ description: 'Тепер інший опис' })).status).toBe(200);
        expect((await list('червоний дитячий велосипед')).products.map((item: { id: string }) => item.id)).not.toContain(ids[0]);
        expect((await agent.patch(`/api/products/${ids[2]}`).send({ status: 'paused' })).status).toBe(200);
        expect((await list('червоний дитячий велосипед')).products.map((item: { id: string }) => item.id)).not.toContain(ids[2]);
        expect((await agent.patch(`/api/buy-requests/${requestId}`).send({ description: 'Тепер інший опис' })).status).toBe(200);
        expect((await agent.get('/api/buy-requests').query({ q: 'червоний дитячий велосипед', buyerUsername: username })).body.buyRequests).toEqual([]);
      } finally {
        await pool.query('DELETE FROM users WHERE username_normalized = $1', [username.toLowerCase()]);
      }
    }, 120000);
  });
} else {
  describe.skip('smart search (requires DATABASE_URL)', () => {});
}
