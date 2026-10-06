export type ActivityGroup = 'attention' | 'active' | 'completed' | 'closed' | 'inactive' | 'all'
export type ActivityKind = 'product' | 'request' | 'offer' | 'deal'

type ActivityItem = { id: string; status: string; createdAt?: string; updatedAt?: string; buyer?: { id: string }; seller?: { id: string }; dispute?: { status: string } | null; buyerResult?: unknown; sellerResult?: unknown; pendingNegotiation?: boolean; waitingConfirmation?: boolean; requestStatus?: string; acceptedQuantity?: number }

export const activeRequestStatuses = ['open', 'partially_selected', 'partially_completed', 'partially_fulfilled']
export const isActiveRequest = (status?: string) => Boolean(status && activeRequestStatuses.includes(status))
export const canEditSellerOffer = (offer: ActivityItem) => isActiveRequest(offer.requestStatus) && offer.status === 'submitted' && offer.acceptedQuantity === 0
export const canWithdrawSellerOffer = (offer: ActivityItem) => isActiveRequest(offer.requestStatus) && ['submitted', 'partially_accepted', 'accepted'].includes(offer.status)

export const activityGroups: Record<ActivityKind, { id: ActivityGroup; label: string; empty: string }[]> = {
    product: [
        { id: 'active', label: 'Активні', empty: 'Активних товарів немає' },
        { id: 'inactive', label: 'Неактивні', empty: 'Неактивних товарів немає' },
        { id: 'completed', label: 'Продані', empty: 'Проданих товарів немає' },
        { id: 'all', label: 'Усі', empty: 'Товарів немає' },
    ],
    request: [
        { id: 'active', label: 'Активні', empty: 'Активних запитів немає' },
        { id: 'completed', label: 'Виконані', empty: 'Виконаних запитів немає' },
        { id: 'closed', label: 'Скасовані', empty: 'Скасованих запитів немає' },
        { id: 'inactive', label: 'Прострочені', empty: 'Прострочених запитів немає' },
        { id: 'all', label: 'Усі', empty: 'Запитів немає' },
    ],
    offer: [
        { id: 'attention', label: 'Потребують дії', empty: 'Пропозицій, що потребують дії, немає' },
        { id: 'active', label: 'Очікують', empty: 'Пропозицій в очікуванні немає' },
        { id: 'completed', label: 'Обрані', empty: 'Обраних пропозицій немає' },
        { id: 'closed', label: 'Відхилені й відкликані', empty: 'Відхилених або відкликаних пропозицій немає' },
        { id: 'inactive', label: 'Інші', empty: 'Інших пропозицій немає' },
        { id: 'all', label: 'Усі', empty: 'Пропозицій немає' },
    ],
    deal: [
        { id: 'attention', label: 'Потребують дії', empty: 'Угод, що потребують вашої дії, немає' },
        { id: 'active', label: 'У процесі', empty: 'Угод у процесі немає' },
        { id: 'completed', label: 'Завершені', empty: 'Завершених угод немає' },
        { id: 'closed', label: 'Не відбулися', empty: 'Скасованих або невдалих угод немає' },
        { id: 'all', label: 'Усі', empty: 'Домовленостей немає' },
    ],
}

export function activityGroup(kind: ActivityKind, item: ActivityItem, viewerId = ''): ActivityGroup {
    if (kind === 'product') return item.status === 'active' ? 'active' : item.status === 'sold' ? 'completed' : 'inactive'
    if (kind === 'request') return ['completed', 'fulfilled'].includes(item.status) ? 'completed' : item.status === 'cancelled' ? 'closed' : item.status === 'expired' ? 'inactive' : 'active'
    if (kind === 'offer') {
        if (['rejected', 'withdrawn'].includes(item.status)) return 'closed'
        if (['draft', 'expired'].includes(item.status)) return 'inactive'
        if (item.waitingConfirmation) return 'attention'
        if (!isActiveRequest(item.requestStatus)) return ['accepted', 'partially_accepted'].includes(item.status) ? 'completed' : 'inactive'
        if (item.pendingNegotiation) return 'attention'
        if (['accepted', 'partially_accepted'].includes(item.status)) return 'completed'
        return item.status === 'submitted' ? 'active' : 'inactive'
    }
    if (item.dispute?.status === 'open') return 'attention'
    if (item.status === 'selected' && item.seller?.id === viewerId) return 'attention'
    if (item.status === 'buyer_marked_completed' && item.seller?.id === viewerId && !item.sellerResult) return 'attention'
    if (item.status === 'seller_marked_completed' && item.buyer?.id === viewerId && !item.buyerResult) return 'attention'
    if (item.status === 'completed') return 'completed'
    if (['failed', 'cancelled', 'rejected', 'expired'].includes(item.status)) return 'closed'
    return 'active'
}

export function activityItems<T extends ActivityItem>(kind: ActivityKind, items: T[], group: ActivityGroup, viewerId = ''): T[] {
    return items.filter(item => group === 'all' || activityGroup(kind, item, viewerId) === group).sort((a, b) => {
        const time = (value: ActivityItem) => Date.parse(value.updatedAt || value.createdAt || '') || 0
        return time(b) - time(a) || b.id.localeCompare(a.id)
    })
}
