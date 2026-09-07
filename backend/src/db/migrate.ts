import dotenv from 'dotenv'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './client.js'

dotenv.config()

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../db/migrations')
const retryDelayMs = 1000
const maxConnectionAttempts = 10

const connectWithRetry = async () => {
    let lastError: unknown

    for (let attempt = 1; attempt <= maxConnectionAttempts; attempt += 1) {
        try {
            return await pool.connect()
        } catch (error) {
            lastError = error

            if (attempt < maxConnectionAttempts) {
                await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
            }
        }
    }

    throw lastError
}

const migrate = async (): Promise<void> => {
    const client = await connectWithRetry()

    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version text PRIMARY KEY,
                applied_at timestamptz NOT NULL DEFAULT now()
            )
        `)

        const migrationFiles = (await readdir(migrationsDirectory))
            .filter((fileName) => fileName.endsWith('.sql'))
            .sort()

        for (const fileName of migrationFiles) {
            const alreadyApplied = await client.query(
                'SELECT 1 FROM schema_migrations WHERE version = $1',
                [fileName],
            )

            if (alreadyApplied.rowCount) {
                continue
            }

            const sql = await readFile(join(migrationsDirectory, fileName), 'utf8')
            await client.query('BEGIN')

            try {
                await client.query(sql)
                await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [fileName])
                await client.query('COMMIT')
                console.log(`Applied ${fileName}`)
            } catch (error) {
                await client.query('ROLLBACK')
                throw error
            }
        }

        console.log('Database is up to date')
    } finally {
        client.release()
        await pool.end()
    }
}

migrate().catch((error: unknown) => {
    console.error('Database migration failed', error)
    process.exitCode = 1
})
