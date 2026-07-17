# Resale Marketplace — Design

**Date:** 2026-07-16
**Status:** Approved

Rethread partners with local thrift/resale retailers (pilot: Uptown Cheapskate). Users list closet
items for sale; approved retailers browse listings, make offers, and fulfill via in-store drop-off
or a prepaid shipping label. Rethread earns a kickback per completed sale, settled offline using
the in-app deal history as the ledger. No money moves through the app.

## Decisions (settled during brainstorming)

1. **Price estimate is computed at scan time, shown only at listing time.** The estimate rides
   along in the existing Gemini cost-estimation call (near-zero marginal cost, freshest data), but
   is never displayed on the result page or closet tile. It is revealed only inside the listing
   flow as an "instant evaluation."
2. **Ultraconservative estimates.** The prompt targets what a thrift buyer *pays out* (typically
   20–30% of resale price, not the resale price), rounds down, and drops lower on any uncertainty
   about brand or condition. UI copy leans on the low end ("Estimated payout: $6–10"). Goal:
   retailer offers land at or above the estimate, never below — no disappointed users.
3. **Retailers never see the estimate.** It is deliberately low; showing it would anchor offers
   down, hurting users and completion rates.
4. **Trust via transparency, not delay.** The "instant evaluation" is a 2–4 s staged reveal
   (reusing the loading-screen blurb-cycler pattern) that shows genuine work — condition, brand
   demand, category resale strength — then presents the range with its factors as line items.
5. **Self-serve retailer signup** behind a small "Sign up as a retailer" toggle on the login page,
   gated by a **manual approval queue** (status flipped in the Firebase console for MVP).
6. **All listings visible to all approved retailers**, sorted nearest-first from the store.
7. **Single take-it-or-leave-it offers** — no counteroffer loop. Competition comes from multiple
   retailers offering on the same listing.
8. **Fulfillment:** in-store drop-off (always available) or integrated shipping label via
   **Shippo** on a single platform account.
9. **No payments in-app.** Retailer pays the user directly; completed-deal records (final amount,
   store, timestamps) are the kickback ledger.

## 1. Roles & retailer signup

- `users/{uid}` gains `role: 'user' | 'retailer'` (absent ⇒ user) and, for retailers, a
  `retailer` map: `{ storeName, address, lat, lng, phone, status: 'pending' | 'approved',
  appliedAt }`.
- Login page: existing Google sign-in, plus a small text link at the bottom — "Sign up as a
  retailer" — toggling to the retailer flow: same Google sign-in followed by a store-details form
  (store name, address via Places autocomplete, phone). Submitted through an extended
  `POST /api/auth/callback` payload; doc created with `status: 'pending'`.
- Pending retailers see an "application under review" screen. Approval = flip `retailer.status`
  to `'approved'` in the Firebase console (admin page is future work).
- Every retailer API route checks `role === 'retailer' && retailer.status === 'approved'`.

## 2. Resale estimate

- `estimateCost` in `lib/google/gemini.ts` gets a `resale` block in its `responseSchema`:
  `{ low_usd: number, high_usd: number, confidence: 'high'|'medium'|'low', factors: string[] }`.
- Stored on `ScanResult.cost` (or sibling field on `ScanResult`); persisted with the scan.
- Prompt requirements: estimate thrift-store *payout* not resale price; round down; when brand or
  condition is uncertain, go lower; factors are short human-readable reasons ("denim resells
  strongly", "fast-fashion brand limits payout").

## 3. Data model (Firestore)

Top-level `listings/{listingId}` (denormalized so retailers never read user subcollections):

```
ownerUid: string
scanId: string
status: 'active' | 'accepted' | 'completed' | 'cancelled'
garment: { brand?, category?, color?, condition?, fibers }   // snapshot
imageUrls: string[]                                          // Firebase Storage URLs
estimate: { low_usd, high_usd }                              // never sent to retailers
approxLocation: { lat, lng, city? }                          // coords rounded ~1 km
offerCount: number
acceptedOfferId?: string
fulfillment?: 'dropoff' | 'ship'
dropoffCode?: string                                         // short code for in-store match
shipping?: { labelUrl, trackingNumber, carrier }             // set after label purchase
shipFrom?: { name, street1, city, state, zip }               // user address, only if shipping
finalAmountUsd?: number                                      // set at completion — kickback ledger
createdAt / acceptedAt / completedAt: Timestamp
```

`listings/{id}/offers/{offerId}`:

```
retailerUid, storeName, storeLat, storeLng
amountUsd: number
note?: string
status: 'open' | 'accepted' | 'declined' | 'withdrawn'
createdAt: Timestamp
```

Constraints:
- One **open** offer per retailer per listing; withdraw-and-re-offer allowed.
- Accepting an offer auto-declines all other open offers (batched write).
- `users/{uid}/scans/{scanId}` gains `listingId` + `listingStatus` mirror fields so the closet
  tile tag renders without extra queries. Mirror is updated in the same batch as every listing
  status change.
- Deleting a scan with an active listing cancels the listing in the same batch.
- Exact user address enters the system only at shipping time (`shipFrom`), visible only to the
  accepted retailer.

## 4. User flow

- Entry points: closet detail page, and the result page "list" outcome — a "Sell to a local
  store" button.
- Instant evaluation: staged reveal (2–4 s, blurb cycler) → conservative range + factor line
  items → "List it" confirmation → `POST /api/listings`.
- Closet tile tag: **Listed** → **Offer** (≥1 open offer) → **Sold** (completed). Cancelled
  listings clear the tag.
- Offers render on the closet detail page as store cards (name, distance, amount, note) with
  Accept / Decline.
- Accepting prompts fulfillment choice:
  - **Drop off:** shows store address + short confirmation code.
  - **Ship:** user enters their address; page then shows "waiting for label" until the retailer
    sends one, after which the label PDF is downloadable.

## 5. Retailer experience

- `/retailer` dashboard (role-guarded):
  - **Listings feed:** active listings, nearest-first from the store, cards with photos,
    brand/category/condition/fibers, and an offer form (amount + optional note). No estimate shown.
  - **Deals tab:** their accepted offers. Shipped deals: "Send shipping label" button (needs the
    user's address to be present). All deals: "Mark received" → sets `completed`, records
    `finalAmountUsd` (= accepted amount), stamps `completedAt`.
- Pending-approval retailers see the review screen instead of the dashboard.

## 6. Shipping (Shippo)

- `lib/shippo.ts`, server-side only, `SHIPPO_API_KEY` env var (test mode for development).
- "Send label": server creates a shipment (from: user's `shipFrom`, to: store address; parcel
  dimensions defaulted per garment category), purchases the cheapest rate, stores
  `{ labelUrl, trackingNumber, carrier }` on the listing.
- No tracking webhooks in MVP — retailer marks received manually.
- Label costs hit the platform Shippo account; reconciled offline with kickback settlement.
- Shippo failure leaves the deal in `accepted` with a retry-able button; error surfaced to the
  retailer.

## 7. API surface

| Route | Auth | Action |
|---|---|---|
| `POST /api/listings` | user | create listing from own scanId |
| `PATCH /api/listings/[id]` | owner | cancel listing |
| `POST /api/listings/[id]/offers` | approved retailer | make offer (409 if listing not active or open offer exists) |
| `POST /api/listings/[id]/offers/[offerId]/accept` | owner | accept; auto-decline others; set fulfillment + address/code |
| `POST /api/listings/[id]/offers/[offerId]/decline` | owner | decline |
| `POST /api/listings/[id]/offers/[offerId]/withdraw` | offer's retailer | withdraw |
| `GET /api/retailer/listings` | approved retailer | active feed, distance-sorted, estimate stripped |
| `GET /api/retailer/deals` | approved retailer | their accepted/completed deals |
| `POST /api/listings/[id]/label` | accepted retailer | purchase Shippo label |
| `POST /api/listings/[id]/received` | accepted retailer | mark completed |

All multi-doc writes use Firestore `WriteBatch` (matching the existing outcome/delete pattern).
Existing rate limiter reused on write routes. Estimate fields stripped from every
retailer-facing response.

## 8. Error handling

- Offer on non-active listing → 409. Accept on already-accepted listing → 409.
- Label purchase without `shipFrom` → 400 with "waiting for user address".
- Scan deletion cancels any active listing atomically; completed listings survive scan deletion
  (ledger integrity) but lose the closet mirror.
- Firestore failure on mirror update: batch semantics — either everything commits or nothing.

## 9. Testing

Bun tests: listing/offer state machine (accept auto-declines, 409 paths), role + approval guards
on retailer routes, Gemini schema parse with the new `resale` block, distance sort, Shippo module
mocked (label success/failure paths).

## Build order

1. Roles + retailer signup + approval gate
2. Estimate field + listing flow + closet tags
3. Retailer feed + offers + accept/decline (drop-off fulfillment)
4. Shippo labels + completion/ledger
