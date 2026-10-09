import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

// Opt-in network check: actual provider polygons and an isolated real PostgreSQL DB.
const enabled = Boolean(process.env.DATABASE_URL && process.env.STEP8_LIVE_GEO === '1');
describe.skipIf(!enabled)('live subscription suburbs (no provider stubs)', () => {
  it('saves Rivne 10 km, reuses search geometry, matches public points and multiple cities', async () => {
    if (!/^\/step8_final_\d+$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error('Use a dedicated step8_final_* test database');
    const { createApp } = await import('./app.js');
    const { pool } = await import('./db/client.js');
    const { cityBoundary, withinCityOrDistance } = await import('./city-boundaries.js');
    const { getSettlement, searchSettlements } = await import('./settlements.js');
    const app = createApp(), seller = request.agent(app), buyer = request.agent(app);
    const suffix = randomUUID().replaceAll('-', '').slice(0,12), users: string[] = [];
    try {
      for (const [index, agent] of [seller,buyer].entries()) {
        const username = `live_sub_${index}_${suffix}`;
        const registered = await agent.post('/api/auth/register').send({username,email:`${username}@example.com`,countryCode:'UA',phone:`+38067${String(Math.floor(Math.random()*1e7)).padStart(7,'0')}`,password:'StrongPassword1',passwordConfirmation:'StrongPassword1'});
        expect(registered.status,JSON.stringify(registered.body)).toBe(201); users.push(registered.body.user.id);
      }
      const rivne = getSettlement('UA56060470010041018')!;
      const kyiv = searchSettlements('Київ').settlements.find(item=>item.name==='Київ')!;
      const barmaky = searchSettlements('Бармаки').settlements.find(item=>item.name==='Бармаки')!;
      const categoryId = (await seller.get('/api/categories')).body.categories.find((c:{code:string})=>c.code==='honey').id;
      const saved = await seller.post('/api/demand-subscriptions').send({categoryId,settlementCodes:[rivne.code],cityOutsideKm:10,minPrice:170,maxPrice:190,unit:'kg',currency:'UAH'});
      expect(saved.status,JSON.stringify(saved.body)).toBe(201);
      expect(saved.body.subscription).toMatchObject({cityOutsideKm:10,matchCount:0});
      expect(saved.body.subscription).not.toHaveProperty('settlementBoundaries');
      const id = saved.body.subscription.id;
      const stored = (await pool.query('SELECT settlement_boundaries FROM demand_subscriptions WHERE id=$1',[id])).rows[0].settlement_boundaries[rivne.code];
      expect(stored.source).toMatchObject({provider:'OSM',settlementCode:rivne.code,osmType:'relation'});
      const search = await cityBoundary(rivne.name,{latitude:50.6196175,longitude:26.2513165},rivne);
      expect(stored.polygons).toEqual(search?.polygons);
      const inside = {latitude:50.6196175,longitude:26.2513165}, suburb = {latitude:50.70,longitude:26.25}, outside = {latitude:50.85,longitude:26.25};
      expect(withinCityOrDistance(inside,stored,0)).toBe(true);
      expect(withinCityOrDistance(suburb,stored,0)).toBe(false);
      expect(withinCityOrDistance(suburb,stored,10)).toBe(true);
      expect(withinCityOrDistance(outside,stored,10)).toBe(false);
      const create = async (point:typeof inside, settlement= barmaky) => {
        const created = await buyer.post('/api/buy-requests').send({categoryId,title:`Live suburbs ${suffix}`,description:'Мед без зазначеного бюджету',quantity:12.5,unit:'kg',currency:'UAH',minPrice:null,maxPrice:null,receiptMethod:'SELLER_DELIVERY',geoArea:settlement.name,settlementCode:settlement.code,...point,mapLocationMode:'approximate',addressVisibility:'private',address:'Приватна адреса LIVE 123'});
        expect(created.status,JSON.stringify(created.body)).toBe(201); return created.body.buyRequest.id;
      };
      const insideId = await create(inside,rivne), suburbId = await create(suburb);
      await create(outside);
      // Find a real boundary threshold where rounding changes the outcome.
      let privatePoint: typeof inside | undefined;
      for(let latitude=50.7;latitude<50.8;latitude+=0.0001){
        const exact={latitude,longitude:26.25}, rounded={latitude:Math.floor(latitude*100+.5)/100,longitude:26.25};
        if(withinCityOrDistance(exact,stored,10)!==withinCityOrDistance(rounded,stored,10)){privatePoint=exact;break;}
      }
      expect(privatePoint).toBeDefined();
      const rounded={latitude:Math.floor(privatePoint!.latitude*100+.5)/100,longitude:26.25};
      const thresholdId = await create(privatePoint!);
      const expected = [insideId,suburbId,...(withinCityOrDistance(rounded,stored,10)?[thresholdId]:[])];
      const alerts = (await seller.get('/api/notifications')).body;
      expect(alerts.notifications.map((n:{buyRequestId:string})=>n.buyRequestId).sort()).toEqual(expected.sort());
      expect(JSON.stringify(alerts)).not.toContain('Приватна адреса');
      expect(JSON.stringify(alerts)).not.toContain(String(privatePoint!.latitude));
      await new Promise(resolve=>setTimeout(resolve,1100));
      const multiple = await seller.patch('/api/demand-subscriptions/'+id).send({settlementCodes:[rivne.code,kyiv.code]});
      expect(multiple.status,JSON.stringify(multiple.body)).toBe(200);
      const kyivId = await create({latitude:50.4501,longitude:30.5234},kyiv);
      const matches = await seller.get('/api/demand-subscriptions/'+id+'/matches');
      expect(matches.status).toBe(200);
      expect(matches.body.count).toBe(expected.length+1);
      expect(matches.body.markers.map((m:{id:string})=>m.id).sort()).toEqual([...expected,kyivId].sort());
      expect(JSON.stringify(matches.body)).not.toContain(String(privatePoint!.latitude));
      expect(JSON.stringify(matches.body)).not.toContain('Приватна адреса');
    } finally {
      if(users.length) await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
    }
  },120000);
});
