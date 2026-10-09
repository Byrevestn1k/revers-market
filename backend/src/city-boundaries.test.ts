import { afterEach, describe, expect, it, vi } from 'vitest';
import { cityBoundary, distanceKm, withinCityOrDistance, settlementAdministrativeBoundary, type CityBoundary } from './city-boundaries.js';
import type { Settlement } from './settlements.js';

const ring = [{latitude:0,longitude:0},{latitude:0,longitude:1},{latitude:1,longitude:1},{latitude:1,longitude:0},{latitude:0,longitude:0}];
const boundary: CityBoundary = {rings:[ring],maxDistanceKm:0};
afterEach(() => vi.unstubAllGlobals());
describe('administrative boundary distance reused from city search', () => {
  it('includes the city and measures from its edge, not its distant center', () => {
    expect(withinCityOrDistance({latitude:0.5,longitude:0.99},boundary,0)).toBe(true);
    const nearEdge = {latitude:0.5,longitude:1.005};
    expect(distanceKm(nearEdge,{latitude:0.5,longitude:0.5})).toBeGreaterThan(50);
    expect(withinCityOrDistance(nearEdge,boundary,1)).toBe(true);
    expect(withinCityOrDistance({latitude:0.5,longitude:1.02},boundary,1)).toBe(false);
  });
  it('includes an exact spherical distance boundary and rejects a point just beyond it', () => {
    const point = {latitude:0.5,longitude:1.01};
    const km = distanceKm(point,{latitude:0.5,longitude:1});
    // On a north/south edge, geodesic nearest point differs by less than a micron here.
    expect(withinCityOrDistance(point,boundary,km)).toBe(true);
    expect(withinCityOrDistance(point,boundary,km-0.00001)).toBe(false);
    expect(withinCityOrDistance({latitude:0,longitude:1},boundary,0)).toBe(true);
  });
  it('preserves holes and disconnected polygons', () => {
    const hole = [{latitude:0.4,longitude:0.4},{latitude:0.4,longitude:0.6},{latitude:0.6,longitude:0.6},{latitude:0.6,longitude:0.4},{latitude:0.4,longitude:0.4}];
    const island = ring.map(p => ({latitude:p.latitude+3,longitude:p.longitude+3}));
    const shape = {rings:[ring,island],polygons:[[ring,hole],[island]],maxDistanceKm:0};
    expect(withinCityOrDistance({latitude:0.5,longitude:0.5},shape,0)).toBe(false);
    expect(withinCityOrDistance({latitude:0.5,longitude:0.5},shape,12)).toBe(true);
    expect(withinCityOrDistance({latitude:3.5,longitude:3.5},shape,0)).toBe(true);
  });
  const settlement = (code:string): Settlement => ({code,name:'Рівне',type:'city',district:'Рівненський район',region:'Рівненська область',community:'Рівненська'});
  const record = {name:'Рівне',class:'boundary',type:'administrative',address:{country_code:'ua',state:'Рівненська область'},extratags:{admin_level:'8'},geojson:{type:'Polygon',coordinates:[ring.map(p=>[p.longitude,p.latitude])]}};
  it('accepts only an identified administrative polygon and caches it by settlement', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ok:true,json:async()=>[record]});
    vi.stubGlobal('fetch',fetchMock);
    expect(await settlementAdministrativeBoundary(settlement('identified'))).toMatchObject({polygons:[[ring]]});
    expect(await settlementAdministrativeBoundary(settlement('identified'))).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('polygon_geojson')).toBe('1');
    expect(url.searchParams.get('city')).toBe('Рівне');
    expect(url.searchParams.get('state')).toBe('Рівненська область');
  });
  it('accepts a special-status city administrative level without duplicating its region name', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ok:true,json:async()=>[{...record,name:'Київ',address:{country_code:'ua'},extratags:{admin_level:'4'}}]});
    vi.stubGlobal('fetch',fetchMock);
    expect(await settlementAdministrativeBoundary({code:'special-kyiv',name:'Київ',type:'city',district:'',region:'місто Київ',community:'Київська'})).not.toBeNull();
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('city')).toBe('Київ');
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has('state')).toBe(false);
  });
  it('reuses the search polygon for a place relation with an exact KATOTTG identity', async () => {
    const city = settlement('identified-place');
    const place = {...record,class:undefined,category:'place',type:'city',osm_type:'relation',osm_id:448930,lat:.5,lon:.5,extratags:{katotth:city.code}};
    const fetchMock = vi.fn().mockResolvedValue({ok:true,json:async()=>[place]});
    vi.stubGlobal('fetch',fetchMock);
    const search = await cityBoundary(city.name,{latitude:.5,longitude:.5},city);
    const subscription = await settlementAdministrativeBoundary(city);
    expect(subscription?.polygons).toEqual(search?.polygons);
    expect(subscription?.source).toEqual({provider:'OSM',osmType:'relation',osmId:448930,settlementCode:city.code});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(['missing-code','other-code'])('rejects a place polygon with %s even if its name and region agree', async code => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>[{...record,class:'place',type:'city',osm_type:'relation',extratags:code==='other-code'?{katotth:'wrong'}:{}}]}));
    expect(await settlementAdministrativeBoundary(settlement(code))).toBeNull();
  });
  it.each([
    ['oblast level for an ordinary city',[{...record,extratags:{admin_level:'4'}}]],
    ['point',[{...record,class:'place',type:'city',geojson:{type:'Point',coordinates:[0,0]}}]],
    ['wrong region',[{...record,address:{country_code:'ua',state:'Волинська область'}}]],
    ['community',[{...record,extratags:{admin_level:'7'}}]],
    ['ambiguous',[record,record]],
    ['missing',[]],
    ['invalid',[{...record,geojson:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,95],[0,0]]]}}]],
  ])('fails closed for %s without any center or bounding-box substitute', async (code,records) => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>records}));
    expect(await settlementAdministrativeBoundary(settlement(code))).toBeNull();
  });
  it('handles provider failure without losing canonical city matching', async () => {
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('unavailable')));
    expect(await settlementAdministrativeBoundary(settlement('offline'))).toBeNull();
  });
  it('retries rejected provider data after the negative cache expires', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ok:true,json:async()=>[{...record,address:{country_code:'ua',state:'Волинська область'}}]})
      .mockResolvedValueOnce({ok:true,json:async()=>[record]});
    vi.stubGlobal('fetch',fetchMock);
    const now = Date.now(), clock = vi.spyOn(Date,'now').mockReturnValue(now);
    try {
      const city = settlement('retry-provider');
      expect(await settlementAdministrativeBoundary(city)).toBeNull();
      clock.mockReturnValue(now+61000);
      expect(await settlementAdministrativeBoundary(city)).not.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {clock.mockRestore();}
  });
});
