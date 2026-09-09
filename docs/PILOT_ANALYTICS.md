# Pilot analytics contract

Record only product events and opaque user/order identifiers. Do not add phone,
exact address, message content, or payment data to analytics.

| Event | When | Minimal properties |
| --- | --- | --- |
| `signup` | registration succeeds | userId, countryCode |
| `product_created` | product saved | productId, categoryId |
| `request_created` | buy request published | requestId, categoryId |
| `offer_created` | seller submits offer | offerId, requestId |
| `chat_started` | offer/order chat opens | conversationId, offerId/orderId |
| `offer_accepted` | partial or full acceptance | offerId, orderId, quantity |
| `order_completed` | buyer confirms completion | orderId |
| `review_created` | review succeeds | orderId, rating |

Pilot metrics: active buyers/sellers, offers per request, request-to-offer rate,
time to first offer, acceptance rate, completion rate and repeat rate.
