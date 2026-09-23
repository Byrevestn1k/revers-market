const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({ VITE_API_URL: "", VITE_HERE_API_KEY: "test" })')
    module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
}
const { matchesSettlement, matchesStreet, settlementLabel, resolveSettlement, searchStreets, savedAddressParts } = require('../src/settlement-model.ts')
const { addressFields } = require('../src/address-model.ts')
const { profileSearchAddress } = require('../src/search-location-model.ts')
const village = { code: 'village', type: 'village', name: 'Бармаки', district: 'Рівненський район', region: 'Рівненська область', community: 'Шпанівська' }
const hereVillage = { id: 'here:village', resultType: 'locality', localityType: 'district', address: { district: 'Бармаки', city: 'Рівненський район', county: 'Рівненська область', countryCode: 'UKR' }, position: { lat: 50.63356, lng: 26.3021 } }
assert.equal(matchesSettlement(hereVillage, village), true)
assert.equal(matchesSettlement({ ...hereVillage, address: { ...hereVillage.address, county: 'Київська область' } }, village), false)
assert.equal(matchesSettlement({ ...hereVillage, address: { ...hereVillage.address, district: 'Інше село' } }, village), false)
assert.equal(matchesSettlement({ ...hereVillage, address: { ...hereVillage.address, city: 'Дубенський район' } }, village), false)
const city = { ...village, code: 'city', name: 'Рівне', type: 'city' }
assert.deepEqual(savedAddressParts('Бармаки, Центральна, Рівненський район, Рівненська область', village), { street: 'Центральна', house: '' })
assert.deepEqual(savedAddressParts('Бармаки, Центральна, 12-А, Рівненський район, Рівненська область', village), { street: 'Центральна', house: '12-А' })
assert.deepEqual(savedAddressParts('Центральна, 12-А, Бармаки, Україна', village), { street: '', house: '' })
assert.equal(matchesSettlement({ address: { city: 'Рівне', county: 'Рівненська область' } }, city), true)
assert.equal(matchesSettlement(hereVillage, city), false)
assert.equal(matchesStreet('Тараса Шевченка вулиця', 'вул. Шевченка'), true)
assert.equal(matchesStreet('Соборна вулиця', 'вул. Шевченка'), false)
assert.equal(settlementLabel(village), 'село, Бармаки, Рівненський район, Рівненська область')
assert.equal(settlementLabel({ ...village, type: 'town', name: 'Клевань' }), 'селище, Клевань, Рівненський район, Рівненська область')
assert.deepEqual(addressFields({ address: '', city: village.name, settlement: village, coordinates: null }), { address: null, settlementCode: village.code, addressVisibility: 'private', addressVisibilityConsent: false, mapLocationMode: 'profile', latitude: null, longitude: null })
const point = { latitude: 50.63356, longitude: 26.3021 }
const profile = { exactAddress: 'Бармаки, Нова, 1', addressSettlement: village, addressCoordinates: point, location: 'Київ', mapLocation: { mode: 'pin', latitude: 50.45, longitude: 30.52 } }
assert.deepEqual(profileSearchAddress(profile).coordinates, point)
assert.equal(profileSearchAddress(profile).city, 'Бармаки')
global.fetch = async url => ({ ok: true, json: async () => url.startsWith('/api/') ? { settlements: [village] } : { items: [hereVillage] } })
async function run() {
    assert.deepEqual((await resolveSettlement(village)).coordinates, point)
    global.fetch = async url => ({ ok: true, json: async () => url.startsWith('/api/') ? { settlements: [village, { ...village, code: 'other', community: 'Інша' }] } : { items: [hereVillage] } })
    await assert.rejects(resolveSettlement(village), /однойменні/)
    global.fetch = async url => ({ ok: true, json: async () => url.startsWith('/api/') ? { settlements: [village] } : { items: [{ ...hereVillage, address: { ...hereVillage.address, county: 'Київська область' } }] } })
    await assert.rejects(resolveSettlement(village), /не підтвердив/)
    const town = { ...village, name: 'Млинів', district: 'Дубенський район', type: 'town' }
    const oldHere = { ...hereVillage, address: { ...hereVillage.address, district: 'Млинів', city: 'Млинівський район' } }
    global.fetch = async url => ({ ok: true, json: async () => url.startsWith('/api/') ? { settlements: [town] } : { items: [oldHere] } })
    const resolvedTown = await resolveSettlement(town)
    assert.equal(resolvedTown.district, 'Дубенський район')
    assert.equal(resolvedTown.hereDistrict, 'Млинівський район')
    assert.equal(matchesSettlement(oldHere, resolvedTown), true)
    assert.equal(matchesSettlement({ ...oldHere, address: { ...oldHere.address, county: 'Волинська область' } }, resolvedTown), false)
    const localStreet = { ...hereVillage, resultType: 'street', address: { ...hereVillage.address, street: 'Центральна вулиця' } }
    global.fetch = async url => {
        const params = new URL(url).searchParams
        assert.equal(params.get('q'), 'Центр', 'HERE must receive the entered street prefix directly')
        assert.equal(params.get('at'), '50.63356,26.3021')
        return { ok: true, json: async () => ({ items: [localStreet, { ...localStreet, id: 'wrong', address: { ...localStreet.address, district: 'Інше село' } }, hereVillage] }) }
    }
    assert.deepEqual(await searchStreets({ ...village, coordinates: point }, 'Центр'), [localStreet])
    const prefixQueries = []
    global.fetch = async url => {
        const q = new URL(url).searchParams.get('q'); prefixQueries.push(q)
        return { ok: true, json: async () => ({ items: q === 'Це' ? [localStreet, { ...localStreet, id: 'section', resultType: 'streetSection' }, { ...localStreet, id: 'wrong', address: { ...localStreet.address, district: 'Інше село' } }] : [] }) }
    }
    assert.deepEqual(await searchStreets({ ...village, coordinates: point }, 'вул. Це'), [localStreet])
    assert.deepEqual(prefixQueries, ['Це'])
    console.log('Settlement checks passed: HERE administrative layouts, wrong-region rejection, ambiguity, labels, identity payload, private profile coordinates.')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
