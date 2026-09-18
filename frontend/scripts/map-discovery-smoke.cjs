// Exercise real map layout/selection logic without changing the database or needing a browser.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
    module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
}
const { buildMapNodes, avatarInitials } = require('../src/map-clusters.ts')
const { mapMarkerLabel } = require('../src/map-marker-icons.ts')
const point = (id, owner = 'seller', x = 300, y = 220) => ({ id, kind: 'product', title: `Товар ${id}`, latitude: 50.62, longitude: 26.25, x, y, owner: { id: owner, username: owner }, category: { id: 'cat', name: 'Велосипеди', imageIndex: 12 }, distanceKm: 1, geoZone: 'Рівне', photoUrl: 'https://example.com/photo.jpg' })
const project = (item) => ({ x: item.x, y: item.y })
const options = { zoom: 14, width: 800, height: 560, filtered: false }
const assertConserved = (nodes, items) => assert.deepEqual(nodes.flatMap((node) => node.items.map((item) => item.id)).sort(), items.map((item) => item.id).sort())
const four = Array.from({ length: 4 }, (_, i) => point(String(i)))
const overview = buildMapNodes(four, project, { ...options, zoom: 12 })
assert.equal(overview.length, 1); assert.equal(overview[0].preview, 'count'); assertConserved(overview, four)
const sellers = buildMapNodes(four, project, options)
assert.equal(sellers.length, 1); assert.equal(sellers[0].type, 'seller'); assert.equal(sellers[0].preview, 'avatar')
const individual = buildMapNodes(four, project, { ...options, filtered: true })
assert.equal(individual.length, 4)
assert.ok(individual.every((node) => node.type === 'product' && node.preview === 'category' && node.items.length === 1))
assert.ok(individual.some((node) => node.displaced))
assert.ok(individual.every((node) => node.latitude === 50.62 && node.longitude === 26.25))
const photos = buildMapNodes(four, project, { ...options, filtered: true, zoom: 17, width: 350 })
assert.ok(photos.every((node) => node.size === 40))
for (const zoom of [17, 18, 19]) {
    const single = buildMapNodes([point('own')], project, { ...options, zoom })
    assert.equal(single.length, 1)
    assert.equal(single[0].preview, 'photo')
    assert.equal(single[0].size, 44)
}
assert.equal(photos.length, 4); assert.ok(photos.every((node) => node.preview === 'photo')); assertConserved(photos, four)
assert.deepEqual(photos.map((node) => node.id).sort(), individual.map((node) => node.id).sort())
const otherSeller = [...four, point('other', 'other')]
const sharedAddress = buildMapNodes(otherSeller, project, options)
assert.equal(sharedAddress.length, 2); assertConserved(sharedAddress, otherSeller)
const many = Array.from({ length: 24 }, (_, i) => point('many-' + i))
const broad = buildMapNodes(many, project, { ...options, filtered: true })
assert.equal(broad.length, 1); assert.equal(broad[0].type, 'seller')
const selectedIds = new Set(many.slice(0, 8).map((item) => item.id))
const expanded = buildMapNodes(many, project, { ...options, selectedIds })
assert.equal(expanded.filter((node) => node.type === 'product').length, 8)
assert.equal(expanded.find((node) => node.type === 'seller').items.length, 16)
assertConserved(expanded, many)
// This is the regression: a category filter must yield many individual listings, not category collages.
const spread = Array.from({ length: 10 }, (_, seller) => Array.from({ length: 5 }, (_, item) => point(`${seller}-${item}`, 'owner-' + seller, 130 + (seller % 5) * 210, 180 + Math.floor(seller / 5) * 330))).flat()
const precise = buildMapNodes(spread, project, { ...options, width: 1200, height: 900, filtered: true })
assert.equal(precise.filter((node) => node.type === 'product').length, 50)
assert.ok(precise.every((node) => node.items.length === 1)); assertConserved(precise, spread)
const crowded = Array.from({ length: 500 }, (_, i) => point('dense-' + i, 'owner-' + i, 150 + (i % 7), 220 + (i % 5)))
const packed = buildMapNodes(crowded, project, { ...options, width: 350, filtered: true })
assertConserved(packed, crowded)
assert.ok(packed.some((node) => node.type === 'cluster'))
assert.ok(packed.every((node) => node.x >= node.size / 2 && node.x <= 350 - node.size / 2 && node.y >= node.size / 2 && node.y <= 560 - node.size / 2))
for (let i = 0; i < packed.length; i++) for (let j = i + 1; j < packed.length; j++) {
    assert.ok(Math.hypot(packed[i].x - packed[j].x, packed[i].y - packed[j].y) >= (packed[i].size + packed[j].size) / 2, 'Markers must not overlap')
}
const mixed = [...four, { ...point('request', 'buyer'), kind: 'buyRequest', photoUrl: null }]
const roles = buildMapNodes(mixed, project, { ...options, filtered: true, zoom: 17 })
assertConserved(roles, mixed)
const buyer = roles.find((node) => node.items[0].kind === 'buyRequest')
assert.equal(buyer.type, 'request'); assert.equal(buyer.preview, 'category'); assert.ok(mapMarkerLabel(buyer).startsWith('Шукає:'))
assert.equal(avatarInitials({ username: 'ТестерПродавець125' }), 'Т125')
console.log(`Map discovery passed: 50 separate category pins; same items switch to photos on mobile; seller avatars; 8-item expansion; ${crowded.length} crowded listings conserved; buyer roles; no overlapping pins.`)

async function verifyLive() {
    const base = process.env.DEMO_API_URL ?? 'http://127.0.0.1:3000'
    const read = async (path) => { const response = await fetch(base + path); assert.equal(response.status, 200); return response.json() }
    const all = (await read('/api/map/markers?latitude=50.6199&longitude=26.2516&radiusKm=25&showBuyRequests=false&q=' + encodeURIComponent('ТестерПродавець'))).markers
    assert.equal(all.length, 1107)
    assert.ok(all.every((item) => Object.hasOwn(item.owner, 'avatarUrl')))
    const mercator = (point, zoom) => {
        const scale = 256 * 2 ** zoom, sine = Math.sin(point.latitude * Math.PI / 180)
        return { x: (point.longitude + 180) / 360 * scale, y: (.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale }
    }
    const layout = (items, zoom, filtered, center = { latitude: 50.6199, longitude: 26.2516 }) => {
        const origin = mercator(center, zoom), width = 800, height = 560
        const project = (point) => { const position = mercator(point, zoom); return { x: position.x - origin.x + width / 2, y: position.y - origin.y + height / 2 } }
        const visible = items.filter((item) => { const p = project(item); return p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height })
        const nodes = buildMapNodes(visible, project, { zoom, width, height, filtered })
        assertConserved(nodes, visible)
        return { visible, nodes }
    }
    const overview = layout(all, 12, false)
    assert.equal(overview.nodes.length, 1)
    const detailed = layout(all, 14, false)
    assert.ok(detailed.nodes.length > 10)
    assert.ok(detailed.nodes.some((node) => node.preview === 'avatar'))
    const { categories } = await read('/api/categories')
    const electronics = categories.find((item) => !item.parentId && item.imageIndex === 7)
    assert.ok(electronics)
    const matching = (await read('/api/map/markers?latitude=50.6199&longitude=26.2516&radiusKm=25&showBuyRequests=false&categoryId=' + electronics.id)).markers
    const category = layout(matching, 14, true)
    const separate = category.nodes.filter((node) => node.type === 'product')
    assert.ok(separate.length >= 5)
    const photo = layout(matching, 17, true, separate[0].items[0])
    assert.ok(photo.nodes.some((node) => node.preview === 'photo'))
    console.log(`Live Rivne data: ${all.length} listings; city overview ${overview.nodes.length} pin; zoom 14 ${detailed.nodes.length} pins / ${detailed.visible.length} listings; electronics ${separate.length} individual category pins; zoom 17 ${photo.nodes.filter((node) => node.preview === 'photo').length} product photos.`)
}
if (process.argv.includes('--live')) verifyLive().catch((error) => { console.error(error); process.exitCode = 1 })
