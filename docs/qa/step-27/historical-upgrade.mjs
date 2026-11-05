// Run only against a newly created, disposable database supplied in DATABASE_URL.
import { readFile, readdir } from 'node:fs/promises'
import { strict as assert } from 'node:assert'
import pg from 'pg'

const url = process.env.DATABASE_URL ?? ''
if (!url.includes('127.0.0.1:55434/step27_historical')) throw new Error('Expected isolated step27_historical database')
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
    const files = (await readdir('backend/db/migrations')).filter(file => file.endsWith('.sql')).sort()
    for (const file of files.filter(file => file < '058_chat_origin_visibility.sql')) await client.query(await readFile(`backend/db/migrations/${file}`, 'utf8'))
    const users = (await client.query(`INSERT INTO users (username,username_normalized,country_code,phone,password_hash) VALUES
        ('step27historic1','step27historic1','UA','+380670000101','x'),
        ('step27historic2','step27historic2','UA','+380670000102','x') RETURNING id`)).rows
    const conversation = (await client.query('INSERT INTO conversations DEFAULT VALUES RETURNING id')).rows[0].id
    await client.query("INSERT INTO conversation_participants (conversation_id,user_id,role,deleted_at) VALUES ($1,$2,'buyer',clock_timestamp()),($1,$3,'seller',NULL)", [conversation, users[0].id, users[1].id])
    await client.query('INSERT INTO messages (conversation_id,sender_id,body) VALUES ($1,$2,$3)', [conversation, users[1].id, 'historic'])
    await client.query(await readFile('backend/db/migrations/058_chat_origin_visibility.sql', 'utf8'))
    const rows = (await client.query('SELECT user_id, deleted_at, history_hidden_before, archived_at, pinned_at FROM conversation_participants WHERE conversation_id=$1 ORDER BY user_id', [conversation])).rows
    assert.equal(rows.length, 2)
    const deleted = rows.find(row => row.user_id === users[0].id)
    assert.equal(deleted.history_hidden_before.getTime(), deleted.deleted_at.getTime())
    assert.equal(rows.find(row => row.user_id === users[1].id).history_hidden_before, null)
    assert.equal((await client.query('SELECT count(*)::int AS count FROM messages WHERE conversation_id=$1', [conversation])).rows[0].count, 1)
    assert.equal((await client.query('SELECT profile_user_low FROM conversations WHERE id=$1', [conversation])).rows[0].profile_user_low, null)
    console.log('PASS: legacy messages and participant states preserved; deleted history boundary backfilled; unknown origin remains unknown')
} finally { await client.end() }
