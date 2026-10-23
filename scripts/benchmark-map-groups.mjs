import { performance } from 'node:perf_hooks'
import { pool } from '../backend/src/db/client.ts'
import { MapService } from '../backend/src/map-service.ts'
import { createApp } from '../backend/src/app.ts'
import request from 'supertest'

const queries = []
const measuredPool = {
    async query(sql, parameters) {
        const started = performance.now()
        const result = await pool.query(sql, parameters)
        queries.push({ sql, parameters, ms: Math.round(performance.now() - started) })
        return result
    },
}

try {
    const counts = await pool.query(`SELECT
        (SELECT count(*) FROM products WHERE status = 'active') AS products,
        (SELECT count(*) FROM buy_requests WHERE status IN ('open', 'partially_selected', 'partially_completed', 'partially_fulfilled')) AS requests`)
    const service = new MapService(measuredPool)
    const app = createApp()
    for (const level of ['region', 'district']) {
        queries.length = 0
        const started = performance.now()
        const groups = await service.findGeoGroups({ latitude: 49, longitude: 31 }, { nationwide: true, radiusKm: 200, showProducts: true, showBuyRequests: true }, level)
        console.log(JSON.stringify({ level, active: counts.rows[0], groups: groups.length, total: groups.reduce((sum, group) => sum + group.count, 0), serviceMs: Math.round(performance.now() - started), sqlMs: queries.map(({ ms }) => ms), responseBytes: Buffer.byteLength(JSON.stringify({ markers: [], groups })) }))
        const apiStarted = performance.now()
        const response = await request(app).get('/api/map/markers').query({ latitude: 49, longitude: 31, nationwide: 'true', geoLevel: level })
        console.log(JSON.stringify({ apiStatus: response.status, apiMs: Math.round(performance.now() - apiStarted), responseBytes: Buffer.byteLength(response.text), groups: response.body.groups?.length, total: response.body.total }))
        for (const { sql, parameters } of queries) {
            const plan = (await pool.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql, parameters)).rows[0]['QUERY PLAN'][0]
            const indexes = []
            const walk = node => { if (node['Index Name']) indexes.push(node['Index Name']); for (const child of node.Plans ?? []) walk(child) }
            walk(plan.Plan)
            console.log(JSON.stringify({ planMs: Math.round(plan['Execution Time']), indexes: [...new Set(indexes)] }))
        }
    }
    queries.length = 0
    const searchStarted = performance.now()
    const search = process.env.STEP18_BENCH_QUERY ?? '7999'
    const searched = await service.findGeoGroups({ latitude: 49, longitude: 31 }, { nationwide: true, radiusKm: 200, showProducts: true, showBuyRequests: true, q: search, searchIn: 'all' }, 'region')
    console.log(JSON.stringify({ search, groups: searched.length, total: searched.reduce((sum, group) => sum + group.count, 0), serviceMs: Math.round(performance.now() - searchStarted), sqlMs: queries.map(({ ms }) => ms) }))
    queries.length = 0
    const viewportStarted = performance.now()
    const detail = await service.findMarkers({ latitude: 50.62, longitude: 26.25 }, { nationwide: true, radiusKm: 200, showProducts: true, showBuyRequests: true, viewport: { south: 50.60, north: 50.64, west: 26.23, east: 26.27 } })
    console.log(JSON.stringify({ viewportMarkers: detail.length, detailMs: Math.round(performance.now() - viewportStarted), sqlMs: queries.map(({ ms }) => ms) }))
    for (const { sql, parameters } of queries) {
        const plan = (await pool.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql, parameters)).rows[0]['QUERY PLAN'][0]
        const indexes = []
        const walk = node => { if (node['Index Name']) indexes.push(node['Index Name']); for (const child of node.Plans ?? []) walk(child) }
        walk(plan.Plan)
        console.log(JSON.stringify({ detailPlanMs: Math.round(plan['Execution Time']), indexes: [...new Set(indexes)] }))
    }
} finally {
    await pool.end()
}
