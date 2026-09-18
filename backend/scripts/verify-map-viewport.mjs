import assert from 'node:assert/strict'
const base = process.env.DEMO_API_URL ?? 'http://127.0.0.1:3000'
const params = { latitude: '50.6199', longitude: '26.2516', radiusKm: '25', showBuyRequests: 'false', q: 'ТестерПродавець' }
const get = async (extra = {}) => {
    const response = await fetch(`${base}/api/map/markers?${new URLSearchParams({ ...params, ...extra })}`)
    assert.equal(response.status, 200)
    return (await response.json()).markers
}
const all = await get()
assert.equal(all.length, 1107)
assert.ok(all.every((point) => point.photoUrl && Number.isInteger(point.category.imageIndex)))
assert.ok(all.some((point) => Math.abs(point.longitude * 100 - Math.round(point.longitude * 100)) > 0.01))
const bounds = { south: '50.61', north: '50.63', west: '26.24', east: '26.27' }
const visible = await get(bounds)
assert.ok(visible.length > 0 && visible.length < all.length)
assert.ok(visible.every((point) => point.latitude >= Number(bounds.south) && point.latitude <= Number(bounds.north) && point.longitude >= Number(bounds.west) && point.longitude <= Number(bounds.east)))
const filtered = await get({ ...bounds, categoryId: visible[0].category.id })
assert.ok(filtered.length > 0)
assert.ok(filtered.every((point) => point.category.id === visible[0].category.id))
const invalid = await fetch(`${base}/api/map/markers?${new URLSearchParams({ ...params, south: '90', north: '50' })}`)
assert.equal(invalid.status, 400)
console.log(`Map API verified: ${all.length} products, ${visible.length} in viewport, ${filtered.length} with category; photos, category images, precise demo coordinates and invalid bounds checked.`)
