import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { DATASET } from './rivne-demo-catalog.mjs'

for (const relative of ['../../.env', '../../frontend/.env', '../../frontend/.env.local']) dotenv.config({ path: fileURLToPath(new URL(relative, import.meta.url)) })
const apiKey = process.env.HERE_API_KEY ?? process.env.VITE_HERE_API_KEY
if (!apiKey) throw new Error('The configured address service key is missing')
if (process.env.NODE_ENV === 'production') throw new Error('Demo geocoding is disabled in production')
const limit = Number(process.argv.find((item) => item.startsWith('--limit='))?.split('=')[1] ?? 100000)
const apply = process.argv.includes('--apply')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
    const { rows: users } = await pool.query(`SELECT id, username, exact_address FROM users
        WHERE email LIKE '%@rivne-demo.example.invalid' AND bio LIKE $1 ORDER BY username LIMIT $2`, [`%${DATASET}%`, limit])
    let buildings = 0, streets = 0, skipped = 0, changedProducts = 0
    for (let i = 0; i < users.length; i++) {
        const user = users[i]
        const address = user.exact_address.replace(/,\s*кв\..*$/u, '')
        const params = new URLSearchParams({ q: address, in: 'countryCode:UKR', at: '50.6199,26.2516', lang: 'uk-UA', limit: '3', apiKey })
        const response = await fetch(`https://geocode.search.hereapi.com/v1/geocode?${params}`, { signal: AbortSignal.timeout(20000) })
        if (!response.ok) throw new Error(`Address service HTTP ${response.status}; demo data not changed for ${user.username}`)
        const result = await response.json()
        const match = result.items?.find((item) => item.position && item.address?.city === 'Рівне' && item.position.lat > 50.58 && item.position.lat < 50.67 && item.position.lng > 26.18 && item.position.lng < 26.33 && ['houseNumber', 'street'].includes(item.resultType))
        if (!match) { skipped++; continue }
        if (match.resultType === 'houseNumber') buildings++; else streets++
        if (apply) {
            const changed = await pool.query(`UPDATE products p SET latitude = $1, longitude = $2, updated_at = now()
                FROM users u WHERE u.id = $3 AND u.exact_address = $4 AND u.email LIKE '%@rivne-demo.example.invalid'
                AND p.owner_id = u.id AND p.description LIKE $5`, [match.position.lat, match.position.lng, user.id, user.exact_address, `%${DATASET}%`])
            changedProducts += changed.rowCount
        }
        if (users.length <= 5) console.log(JSON.stringify({ username: user.username, resultType: match.resultType, matchedAddress: match.address.label, latitude: match.position.lat, longitude: match.position.lng }))
        if ((i + 1) % 20 === 0) console.log(`Located ${i + 1}/${users.length} sellers`)
    }
    console.log(JSON.stringify({ sellers: users.length, buildings, streets, skipped, changedProducts, apply }, null, 2))
} finally { await pool.end() }
