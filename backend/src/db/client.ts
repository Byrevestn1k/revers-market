import dotenv from 'dotenv'
import { Pool } from 'pg'

dotenv.config()

if (!process.env.DATABASE_URL) {
    dotenv.config({ path: '../.env' })
}

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
    throw new Error('DATABASE_URL is required')
}

export const pool = new Pool({ connectionString: databaseUrl })

export type DatabaseHealth =
    | { status: 'ok'; latencyMs: number }
    | { status: 'error'; message: string }

export const checkDatabase = async (): Promise<DatabaseHealth> => {
    const startedAt = Date.now()

    try {
        await pool.query('SELECT 1')
        return { status: 'ok', latencyMs: Date.now() - startedAt }
    } catch (error) {
        return {
            status: 'error',
            message: error instanceof Error ? error.message : 'Unknown database error',
        }
    }
}

export const closeDatabase = async (): Promise<void> => {
    await pool.end()
}
