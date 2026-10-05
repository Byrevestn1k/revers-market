import { createContext } from 'react';

export type Conversation = { id: string; orderId?: string | null; offerId?: string | null; productId?: string | null; buyRequestId?: string | null; type: 'direct' | 'offer' | 'deal'; status: string; title?: string; price?: number | null; currency?: string | null; imageUrl?: string | null; categoryId?: string | null; categoryName?: string | null; categoryImageIndex?: number | null; otherUserId?: string; otherUsername: string; otherAvatarUrl?: string | null; userRole?: 'selling' | 'buying'; lastMessage: string | null; lastMessageSenderId?: string | null; lastMessageIsMine?: boolean; lastMessageAt: string | null; lastReadAt: string | null; counterpartLastReadAt?: string | null; pinnedAt?: string | null; archivedAt?: string | null; unreadCount?: number };

// The conversation API is the source for both the list and navigation count.
export const MessagesContext = createContext<{
  conversations: Conversation[];
  loaded: boolean;
  refresh: () => Promise<Conversation[]>;
}>({ conversations: [], loaded: false, refresh: async () => [] });

export function MessageUnreadBadge({ count }: { count: number }) {
  return count > 0 ? <b className="message-unread-count" aria-label={`Непрочитані повідомлення: ${count}`}>{count > 99 ? '99+' : count}</b> : null;
}
