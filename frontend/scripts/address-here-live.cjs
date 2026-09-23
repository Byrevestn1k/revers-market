// Optional real-provider regression check; keys are read locally and never logged.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const dotenv = require('dotenv')
const env = Object.assign({}, ...['.env', 'frontend/.env', 'frontend/.env.local'].filter(fs.existsSync).map(path => dotenv.parse(fs.readFileSync(path))))
global.__addressTestEnv = { VITE_API_URL: 'http://127.0.0.1:3000', VITE_HERE_API_KEY: env.VITE_HERE_API_KEY || env.HERE_API_KEY }
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', 'global.__addressTestEnv'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
const { findSettlements, resolveSettlement, searchStreets, hereRequest, matchesSettlement, matchesStreet } = require('../src/settlement-model.ts')
async function run() {
    assert.ok(global.__addressTestEnv.VITE_HERE_API_KEY, 'HERE key required')
    for (const [name, type, prefix] of [['Рівне', 'city', 'Со'], ['Бармаки', 'village', 'Це'], ['Клевань', 'town', 'Бо']]) {
        const selected = (await findSettlements(name)).find(item => item.name === name && item.type === type && item.region === 'Рівненська область')
        assert.ok(selected, name)
        const resolved = await resolveSettlement(selected)
        const streets = await searchStreets(resolved, prefix)
        assert.ok(streets.length, `No streets for ${name}`)
        assert.ok(streets.every(item => matchesSettlement(item, resolved)))
        console.log(`${name}: ${streets.length} street suggestions`)
        if (type === 'city') {
            for (const short of ['Ш', 'Ше', 'Шев', 'вул. Со']) assert.ok((await searchStreets(resolved, short)).length, `No suggestions for ${short}`)
            const street = streets.find(item => item.address.street === 'Соборна вулиця')
            assert.ok(street)
            const houses = await hereRequest('geocode', { q: `${name}, ${street.address.street}, 1, ${selected.region}`, in: 'countryCode:UKR', limit: '20' })
            assert.ok(houses.some(item => item.position && item.resultType === 'houseNumber' && item.address.houseNumber === '1' && matchesSettlement(item, resolved) && matchesStreet(item.address.street, street.address.street)), 'Selected street must resolve to a house coordinate')
        }
    }
}
run().catch(error => { console.error(error.message); process.exitCode = 1 })
