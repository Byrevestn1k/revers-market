import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    connect: vi.fn(),
    createNotification: vi.fn(),
    usersAreBlocked: vi.fn(),
}))

vi.mock('./db/client.js', () => ({ pool: { connect: mocks.connect } }))
vi.mock('./community-service.js', () => ({
    createNotification: mocks.createNotification,
    usersAreBlocked: mocks.usersAreBlocked,
}))

import { createMessage } from './order-service.js'

describe('message transaction', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.usersAreBlocked.mockResolvedValue(false)
    })

    it('rolls back the message and personal-state restoration when notification creation fails', async () => {
        const query = vi.fn(async (sql: string) => {
            if (sql.includes('FROM conversation_participants') && sql.includes('FOR UPDATE')) return { rows: [
                { user_id: 'sender', role: 'buyer', deleted_at: null },
                { user_id: 'recipient', role: 'seller', deleted_at: new Date() },
            ] }
            if (sql.includes('INSERT INTO messages')) return { rows: [{ id: 'message-1' }] }
            return { rows: [] }
        })
        const release = vi.fn()
        mocks.connect.mockResolvedValue({ query, release })
        mocks.createNotification.mockRejectedValue(new Error('notification insert failed'))

        await expect(createMessage({ id: 'sender' } as any, 'conversation-1', 'Нове повідомлення')).rejects.toThrow('notification insert failed')

        const sql = query.mock.calls.map(([statement]) => statement)
        expect(sql[0]).toBe('BEGIN')
        expect(sql.some(statement => statement.includes('INSERT INTO messages'))).toBe(true)
        expect(sql.some(statement => statement.includes('SET deleted_at = NULL'))).toBe(true)
        expect(sql.at(-1)).toBe('ROLLBACK')
        expect(sql).not.toContain('COMMIT')
        expect(release).toHaveBeenCalledOnce()
    })
})
