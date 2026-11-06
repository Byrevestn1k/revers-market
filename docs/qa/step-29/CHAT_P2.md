# Step 29 — P2 chat rating fix

Base HEAD: ac642c40faae97692a5ca7c14f6c315b371c5cd3. The open chat header previously relied on an optional name and displayed neither counterpart role nor rating. The fix uses the authenticated conversation list's `otherUserId`, `otherUsername`, `contextKind` and `userRole`; it requests the existing public profile, verifies the returned ID, and selects `sellerRating` for a buyer or `buyerRating` for a seller. The request is tied to conversation, user and role, and stale responses are discarded. Context-free DIRECT conversations do not receive a role or rating. Missing reviews show the Ukrainian empty state. No server contract, Deal snapshot or rating calculation changed.

Validation:
- `npm run typecheck` passed.
- Backend targeted sequential run: 38 passed, covering Deal review workflow, Step 27 chat security/context and direct Product Deal tests. The prior full backend run on ac642c40 was 310 passed, 1 skipped; no backend source was changed here.
- Chromium: `profile.spec.ts` Product and Buy Request scenario passed at 390/1280 after an earlier timeout with concurrent tests. Actual visible open-chat header is scoped by `data-testid`; buyer sees the seller name, seller role and 12/12, seller sees the buyer name, buyer role and 7/12; the wrong role value is rejected. Checked empty rating and both sides of DIRECT at 390/1280; checked Product, Buy Request and Deal context headers for both participants at 1280; Offer at 390/1280. Checks include visible text overflow and navigation among chats. Accounts, listings and Deal were set up using API, reviews through UI. Screenshots `chat-*` in this directory record the cases.
- Public profile privacy remains enforced by the existing endpoint; Step 27 tests exercised access controls. No independent exhaustive privacy audit was performed.

UNVERIFIED: every possible historical or malformed conversation and profile fetch failure; UI-specific Product, Buy Request and Deal context at 320/768/1024/1440 px. A failed profile request currently leaves the loading label rather than falsely presenting a zero rating. Full backend was not repeated because this change modifies frontend and tests only.
