import type { PoolClient } from 'pg'

type Queryable = Pick<PoolClient, 'query'>

// This is called inside the same transaction that changes a Deal.  It keeps
// the request totals independent from its display status.
export const refreshRequestQuantities = async (queryable: Queryable, requestId: string) => {
    const totals = await queryable.query<{ selected_quantity: string; completed_quantity: string; requested_quantity: string; status: string }>(
        `SELECT r.requested_quantity, r.status,
            COALESCE(SUM(o.quantity) FILTER (WHERE o.status IN ('accepted', 'selected', 'in_progress', 'buyer_marked_completed', 'seller_marked_completed', 'disputed')), 0) AS selected_quantity,
            COALESCE(SUM(COALESCE(o.actual_quantity, o.quantity)) FILTER (WHERE o.status = 'completed'), 0) AS completed_quantity
         FROM buy_requests r LEFT JOIN orders o ON o.buy_request_id = r.id
         WHERE r.id = $1 GROUP BY r.id`, [requestId],
    )
    const row = totals.rows[0]
    if (!row) return null
    const selected = Number(row.selected_quantity)
    const completed = Number(row.completed_quantity)
    const requested = Number(row.requested_quantity)
    const status = row.status === 'cancelled' || row.status === 'expired' ? row.status
        : completed >= requested ? 'completed'
            : selected > 0 ? 'partially_selected'
                : completed > 0 ? 'partially_completed' : 'open'
    await queryable.query(
        `UPDATE buy_requests SET selected_quantity = $1, completed_quantity = $2,
            fulfilled_quantity = $2, status = $3,
            closed_at = CASE WHEN $3 = 'completed' THEN COALESCE(closed_at, now()) ELSE closed_at END,
            updated_at = now() WHERE id = $4`,
        [selected, completed, status, requestId],
    )
    return { requestedQuantity: requested, selectedQuantity: selected, completedQuantity: completed, remainingQuantity: requested - selected - completed, status }
}
