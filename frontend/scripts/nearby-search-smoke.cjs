const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({ VITE_API_URL: "", VITE_HERE_API_KEY: "" })'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
const { nearestZoom, distanceKm, parseIpCity, normalizeCity, savedSearchCity, profileSearchAddress } = require('../src/search-location-model.ts')
const home = { latitude: 50.62, longitude: 26.25 }
const close = { latitude: 50.62003, longitude: 26.25003 }
const distant = { latitude: 50.66, longitude: 26.3 }
const profile = { exactAddress: 'Рівне, Соборна, 1', location: 'Львів', mapLocation: { mode: 'pin', latitude: 49.84, longitude: 24.03 } }
assert.equal(profileSearchAddress(profile, null).coordinates, null, 'Seller public pin is not the private search home')
const fromProfile = profileSearchAddress(profile, { position: { lat: home.latitude, lng: home.longitude }, address: { city: 'Рівне' } })
assert.deepEqual(fromProfile, { address: profile.exactAddress, city: 'Рівне', coordinates: home, settlement: undefined })
fromProfile.address = 'Лише для пошуку'
assert.equal(profile.exactAddress, 'Рівне, Соборна, 1', 'Search overrides must not mutate the profile')
assert.deepEqual(profileSearchAddress({ ...profile, mapLocation: { mode: 'address', ...home } }, null).coordinates, home)
assert.equal(nearestZoom(home, [close], 800, 560), 19)
assert.ok(nearestZoom(home, [distant], 800, 560) < nearestZoom(home, [close], 800, 560))
assert.equal(nearestZoom(home, [close, distant], 800, 560), 19, 'Distant outliers must not pull the nearby search away from home')
assert.equal(nearestZoom(home, Array(100).fill(home), 320, 480), 19, 'Many listings at one point do not force a zoom out')
assert.equal(nearestZoom(home, [], 800, 560), 12)
assert.ok(nearestZoom(home, [distant], 320, 480) <= nearestZoom(home, [distant], 1200, 800))
assert.ok(distanceKm(home, close) < .01)
assert.equal(normalizeCity(' м. Рівне '), 'рівне')
assert.equal(parseIpCity({ country: 'Ukraine', city: 'Rivne', lat: 50.62, lon: 26.25 }).name, 'Рівне')
assert.equal(parseIpCity({ location: { country_code: 'UA', city: 'Rivne', latitude: 50.62, longitude: 26.25 } }).name, 'Рівне')
for (const data of [null, {}, { country: 'US', city: 'Boston', lat: 42, lon: -71 }, { country: 'Ukraine', city: 'Rivne', lat: null, lon: null }, { is_vpn: true, location: { country_code: 'UA', city: 'Rivne', latitude: 50.62, longitude: 26.25 } }]) assert.equal(parseIpCity(data), null)
global.localStorage = { getItem: () => JSON.stringify({ name: 'Тестове місто', ...home }) }
assert.equal(savedSearchCity().name, 'Тестове місто')
global.localStorage.getItem = () => '{bad'
assert.equal(savedSearchCity(), null)
global.localStorage.getItem = () => null
assert.equal(savedSearchCity(), null, 'No stored city permits nationwide search')
console.log('Nearby search passed: home-centred maximum zoom, distant and dense results, mobile fit, empty state, IP validation/localization and saved city.')
