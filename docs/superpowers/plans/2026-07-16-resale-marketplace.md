# Resale Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users list closet items for sale; self-serve (approval-gated) retailers browse listings nearest-first, make single take-it-or-leave-it offers, and fulfill via in-store drop-off or a Shippo shipping label. Completed deals are the kickback ledger.

**Architecture:** Top-level Firestore `listings` collection (denormalized scan snapshot) with `offers` subcollection; mirror fields (`listingId`, `listingStatus`) on `users/{uid}/scans/{scanId}` keep closet tiles cheap. All writes are Admin-SDK batches from Next.js API routes. Resale estimate rides in the existing Gemini `computeCost` call and is only surfaced in the listing flow.

**Tech Stack:** Next.js 15 App Router, Firebase Admin (Firestore/Auth/Storage), Gemini 2.5 Flash structured output, Shippo REST API, Bun tests with `mock.module`.

**Spec:** `docs/superpowers/specs/2026-07-16-resale-marketplace-design.md`

## Global Constraints

- Estimates are ultraconservative: thrift *payout* (20–30% of resale price), rounded **down**, lower on uncertainty. Copy leans on the low end.
- Retailer-facing responses NEVER include `estimate`, `ownerUid`, `shipFrom` (except the accepted retailer's own deal for shipFrom), or `dropoffCode` (dropoffCode IS shown to the accepted retailer for matching — but never on the public feed).
- All retailer API routes require `role === 'retailer' && retailer.status === 'approved'`.
- All multi-doc writes use `db().batch()` (see `app/api/scan/[id]/outcome/route.ts:80`).
- Reuse `checkRateLimit`/`getClientIp` on every POST/PATCH route (pattern: `app/api/scan/[id]/outcome/route.ts:21-28`).
- Tests use bun `mock.module` before dynamic route import (pattern: `__tests__/api/outcome.test.ts`).
- Approx location on listings: coords rounded to 2 decimals (~1.1 km).
- New env var: `SHIPPO_API_KEY` (test-mode token in dev). Document in README env section.
- UI follows existing Tailwind idiom (`text-ink`, `bg-surface`, `border-rule`, rounded-xl cards).

---

## Phase 1 — Roles & retailer signup

### Task 1: Marketplace types + pure helpers

**Files:**
- Create: `types/marketplace.ts`
- Create: `lib/marketplace.ts`
- Test: `__tests__/lib/marketplace.test.ts`

**Interfaces (Produces):**
```ts
// types/marketplace.ts
import type { Fiber, GarmentCondition } from './garment';

export type RetailerStatus = 'pending' | 'approved';
export type StoreAddress = { street1: string; city: string; state: string; zip: string };
export type RetailerProfile = StoreAddress & {
  storeName: string; phone: string; lat: number | null; lng: number | null;
  status: RetailerStatus;
};
export type ResaleEstimate = {
  low_usd: number; high_usd: number;
  confidence: 'high' | 'medium' | 'low'; factors: string[];
};
export type ListingStatus = 'active' | 'accepted' | 'completed' | 'cancelled';
export type OfferStatus = 'open' | 'accepted' | 'declined' | 'withdrawn';
export type FulfillmentMethod = 'dropoff' | 'ship';
export type ShipFromAddress = { name: string; street1: string; city: string; state: string; zip: string };
export type ListingGarment = {
  brand?: string; category?: string; color?: string;
  condition?: GarmentCondition; fibers: Fiber[];
};
export type Offer = {
  id: string; retailerUid: string; storeName: string;
  storeLat: number | null; storeLng: number | null;
  amountUsd: number; note?: string; status: OfferStatus; createdAt: number;
};
export type Listing = {
  id: string; ownerUid: string; scanId: string; status: ListingStatus;
  garment: ListingGarment; imageUrls: string[];
  estimate: ResaleEstimate | null;
  approxLocation: { lat: number; lng: number } | null;
  offerCount: number;
  acceptedOfferId?: string; acceptedRetailerUid?: string; acceptedAmountUsd?: number;
  fulfillment?: FulfillmentMethod; dropoffCode?: string;
  shipFrom?: ShipFromAddress;
  shipping?: { labelUrl: string; trackingNumber: string; carrier: string };
  finalAmountUsd?: number;
  createdAt: number; acceptedAt?: number; completedAt?: number;
};
```
```ts
// lib/marketplace.ts
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number
export function roundCoord(v: number): number            // 2-decimal rounding
export function generateDropoffCode(): string            // 6 chars, unambiguous A-Z0-9 (no I,O,0,1), crypto-random
export const FIRESTORE_ID_RE: RegExp                     // /^[A-Za-z0-9]{10,30}$/
```

- [ ] **Step 1:** Write `__tests__/lib/marketplace.test.ts`: haversine(0,0,0,1)≈111.19 (±0.5); roundCoord(43.65789)=43.66; dropoff code matches `/^[A-HJ-NP-Z2-9]{6}$/` and 100 generations produce >1 unique value; FIRESTORE_ID_RE accepts `'abcDEF12345'`, rejects `'a/b'` and `''`.
- [ ] **Step 2:** Run `bun test __tests__/lib/marketplace.test.ts` — FAIL (module not found).
- [ ] **Step 3:** Implement both files. Haversine: R=6371, standard formula. `generateDropoffCode`: `crypto.getRandomValues(new Uint32Array(6))` mapped over alphabet `'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'`.
- [ ] **Step 4:** Run test — PASS. Run `bun test` (full suite) — all green.
- [ ] **Step 5:** Commit `feat(marketplace): types and pure helpers`.

### Task 2: Geocoding helper + retailer signup via auth callback

**Files:**
- Modify: `lib/google/places.ts` (append `geocodeAddress`)
- Modify: `app/api/auth/callback/route.ts`
- Test: `__tests__/api/auth-callback.test.ts`

**Interfaces:**
- Produces: `geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null>` — Places `searchText`, first result's location; null on any failure (never throws).
- Produces: `POST /api/auth/callback` accepts optional JSON body `{ retailer: { storeName, street1, city, state, zip, phone } }`. All strings required, each 1–120 chars, zip `/^\d{5}(-\d{4})?$/`. On valid payload sets on user doc: `role: 'retailer'`, `retailer: { storeName, street1, city, state, zip, phone, lat, lng, status: 'pending', appliedAt: serverTimestamp }` (lat/lng from geocoding `"{street1}, {city}, {state} {zip}"`, null on failure). Never downgrades an existing `'approved'` status. Response gains `role: 'user' | 'retailer'` and `retailerStatus: RetailerStatus | null` (+ `storeName` when retailer) — for ALL callers (body-less requests included, read from the doc).

- [ ] **Step 1:** Write tests (mock `verify-token`, `admin`, `firebase-admin/firestore`, and `@/lib/google/places`): body-less call for existing user returns `role: 'user'`, `retailerStatus: null`; retailer payload on new user creates doc with role retailer + pending status; invalid zip → 400; retailer payload on user already `approved` does not overwrite status (assert the `set` merge payload's `retailer.status` is not `'pending'` — implementation should omit the retailer block entirely when already approved); geocode failure still succeeds with `lat: null`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement. Body parse: `await request.json().catch(() => null)` (body is optional). Validation helper inline. Geocode via try/catch.
- [ ] **Step 4:** Run tests + full suite — PASS.
- [ ] **Step 5:** Commit `feat(auth): retailer signup payload on auth callback`.

### Task 3: Retailer verification guard

**Files:**
- Create: `lib/firebase/verify-retailer.ts`
- Test: `__tests__/lib/verify-retailer.test.ts`

**Interfaces:**
```ts
export type VerifiedRetailer = {
  uid: string; storeName: string; phone: string;
  street1: string; city: string; state: string; zip: string;
  lat: number | null; lng: number | null;
};
export async function verifyApprovedRetailer(request: Request): Promise<VerifiedRetailer | null>
```
Verifies bearer token (`verifyBearerToken`), loads `users/{uid}`, returns null unless `role === 'retailer' && retailer?.status === 'approved'`; otherwise returns flattened profile.

- [ ] **Step 1:** Tests: null when no token; null when role user; null when status pending; profile returned when approved.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS + full suite.
- [ ] **Step 5:** Commit `feat(auth): approved-retailer guard`.

### Task 4: Login page retailer toggle + auth-context role + /retailer shell

**Files:**
- Modify: `app/login/page.tsx`
- Modify: `lib/firebase/auth-context.tsx`
- Create: `app/retailer/page.tsx`
- Modify: `components/header-nav.tsx` (retailer link when role retailer)

**Interfaces:**
- `AuthUser` gains `role?: 'user' | 'retailer'`, `retailerStatus?: 'pending' | 'approved' | null`, `storeName?: string | null` (populated from the extended callback response in `callAuthCallback`).

- [ ] **Step 1:** Login page: add `mode` state (`'user' | 'retailer'`). Footer link below the terms text: small `text-[12px] text-ink-faint underline` button — "Sign up as a retailer" / "← Back to user sign-in". Retailer mode replaces heading ("Partner with Rethread" / "Get offers from local sellers by joining as a resale partner.") and shows a store form ABOVE the Google button: storeName, street1, city, state, zip, phone (controlled inputs, existing input idiom `rounded-xl border border-rule px-4 py-3 text-[14px]`). Google button disabled until all fields non-empty and zip matches `/^\d{5}(-\d{4})?$/`. On click: `signInWithPopup` → POST `/api/auth/callback` with JSON body `{ retailer: {...} }` + bearer → `router.push('/retailer')`.
- [ ] **Step 2:** auth-context: parse `role`, `retailerStatus`, `storeName` from callback response into `user`.
- [ ] **Step 3:** `app/retailer/page.tsx` (client): `useAuth()`. Loading → `<LoadingScreen blurbs={['Opening your storefront']} />`. Not signed in / role !== 'retailer' → centered card linking to `/login`. `retailerStatus === 'pending'` → "Application under review" card ("We review every partner application by hand. You'll get access as soon as you're approved."). Approved → placeholder dashboard heading (filled in Task 10).
- [ ] **Step 4:** header-nav: when `user?.role === 'retailer'`, profile-avatar link targets `/retailer` instead of `/profile`.
- [ ] **Step 5:** `bun test` green; `bunx tsc --noEmit` (or `bun run build` if no tsc script) clean. Manual: `bun dev`, verify toggle renders.
- [ ] **Step 6:** Commit `feat(retailer): signup flow, role-aware auth context, dashboard shell`.

---

## Phase 2 — Estimate + listing flow

### Task 5: Resale estimate in Gemini computeCost

**Files:**
- Modify: `types/garment.ts` (add `resale?: ResaleEstimate` to `EnvironmentalCost`; re-export `ResaleEstimate` from types/marketplace)
- Modify: `lib/google/gemini.ts`
- Test: `__tests__/lib/resale-estimate.test.ts`

**Interfaces:**
- Produces: exported `normalizeResaleEstimate(value: unknown): ResaleEstimate | null` — null unless object with numeric low/high; floor both to ints; clamp low ≥ 1; `high = max(high, low)`; confidence defaults `'low'`; factors → sanitized strings (reuse `sanitizeResponseText`, 80 chars), max 4.
- `computeCost` returns `EnvironmentalCost` with `resale` populated when Gemini returns it (schema-required, but normalize defensively).

- [ ] **Step 1:** Tests for `normalizeResaleEstimate`: valid object floors decimals (`{low_usd: 6.9, high_usd: 11.2}` → 6/11); swapped bounds corrected; garbage → null; factors truncated to 4 and HTML-stripped.
- [ ] **Step 2:** FAIL → **Step 3:** implement:
  - Prompt additions in `buildPrompt` (after disposal section):
    ```
    'Also estimate the resale payout a thrift/consignment store would PAY THE OWNER for this garment, in USD:',
    '- Thrift stores pay roughly 20-30% of what they can resell the item for.',
    '- BE ULTRACONSERVATIVE: round DOWN, and when brand, condition, or category is uncertain, go lower.',
    '- A disappointing-low estimate is fine; an optimistic-high estimate is a failure.',
    '- resale_low_usd / resale_high_usd: integers, low >= 1. Keep the range tight (high <= 2x low).',
    '- resale_factors: 2-4 short phrases (max 8 words each) a shopper would understand,',
    '  e.g. "denim resells strongly", "fast-fashion brand limits payout", "good condition".',
    ```
  - Schema: add `resale_low_usd: {type:'NUMBER'}`, `resale_high_usd: {type:'NUMBER'}`, `resale_factors: {type:'ARRAY', items:{type:'STRING'}}` to properties + required.
  - After `normalizeDyeAnalysis`, build `resale` via `normalizeResaleEstimate({ low_usd: parsed.resale_low_usd, high_usd: parsed.resale_high_usd, confidence: dye.confidence, factors: parsed.resale_factors })` and spread `...(resale ? { resale } : {})` into the return.
- [ ] **Step 4:** PASS + full suite. **Step 5:** Commit `feat(gemini): ultraconservative resale payout estimate`.

### Task 6: Listing create/cancel API + scan mirror + delete-cancels-listing

**Files:**
- Create: `app/api/listings/route.ts` (POST)
- Create: `app/api/listings/[id]/route.ts` (GET owner detail w/ offers, PATCH cancel)
- Modify: `app/api/user/scans/route.ts` (include `listingId`, `listingStatus` in list items)
- Modify: `app/api/user/scans/[scanId]/route.ts` (GET: include mirror fields; DELETE: cancel non-completed listing in same batch)
- Test: `__tests__/api/listings.test.ts`

**Interfaces:**
- `POST /api/listings` body `{ scanId: string, lat?: number, lng?: number }`, bearer required. 400 bad scanId/body; 404 scan not owned; 409 if scan doc has `listingStatus` of `'active' | 'accepted'`; 201 → `{ listing: Listing }`. Batch: create `listings/{autoId}` `{ ownerUid, scanId, status:'active', garment (from scan result.garment, condition/brand/category/color/fibers only), imageUrls (scan doc imageUrls ?? []), estimate (scan result.cost.resale ?? null), approxLocation (roundCoord'd body coords or null), offerCount: 0, acceptedRetailerUid: null, createdAt: serverTimestamp }` + mirror `{ listingId, listingStatus:'active' }` on scan doc.
- `PATCH /api/listings/[id]` body `{ status: 'cancelled' }`, owner only (404 if listing.ownerUid !== uid); 409 unless current status `'active'`; batch: listing status + mirror `listingStatus:'cancelled'`.
- `GET /api/listings/[id]` owner only → `{ listing, offers: Offer[] }` (offers ordered createdAt desc, timestamps as millis).
- DELETE scans change: after loading scanData, if `scanData.listingId && scanData.listingStatus && scanData.listingStatus !== 'completed'` add `batch.update(db().collection('listings').doc(scanData.listingId), { status: 'cancelled' })`.

- [ ] **Step 1:** Tests (mock rate-limit, verify-token, admin, firestore FieldValue): POST 401 unauth; 400 invalid scanId; 404 missing scan; 409 already listed; 201 commits batch once and mirror set called; PATCH 409 on accepted listing; PATCH 404 wrong owner; GET returns offers array.
- [ ] **Step 2:** FAIL → **Step 3:** implement (UUID_RE for scanId, FIRESTORE_ID_RE for listing id, rate limit on POST/PATCH) → **Step 4:** PASS + full suite.
- [ ] **Step 5:** Commit `feat(listings): create/cancel with closet mirror and delete-cancel`.

### Task 7: Sell flow UI (instant evaluation) + closet tile sale tags

**Files:**
- Create: `components/sell-section.tsx`
- Modify: `components/result-view.tsx` (render `<SellSection>` in readOnly/closet mode; pass scan result + scanId + mirror fields)
- Modify: `app/profile/page.tsx` (sale tag on tile)

**Interfaces:**
- `<SellSection scanId={string} resale={ResaleEstimate | null} listingId={string | null} listingStatus={ListingStatus | null} imageUrls={string[]} />` — self-contained client component; uses `useAuth()` for token.

- [ ] **Step 1:** SellSection states: `idle` (button "Sell to a local store" — hidden if `listingStatus === 'completed'`, replaced by "Sold" banner) → `evaluating` → `reveal` → `listed`. If `listingStatus` already `'active' | 'accepted'`, jump straight to listed/offer view (Task 9 expands it).
  - `evaluating`: 2.5 s staged reveal, NO fake spinner-only: cycle three lines 800 ms apart with the check-appearing pattern ("Assessing condition…", "Weighing brand demand…", "Comparing category resale strength…"), framer-motion `motion.div` fade like existing loading blurbs.
  - `reveal`: card — "Estimated payout" + `$${low}–${high}` (low visually dominant, `text-[32px] font-black`; high `text-[20px] text-ink-muted`), factors as bullet line items, disclaimer "Stores make their own offers — this is a floor, not a promise.", buttons "List it" / "Not now". If `resale` is null: card explains evaluation unavailable, still allows listing.
  - "List it": POST `/api/listings` with `{ scanId, lat, lng }` (geolocation via `navigator.geolocation.getCurrentPosition`, 3 s timeout, proceed without on failure) → `listed` state ("Your item is live. Local stores can now make offers.").
- [ ] **Step 2:** Wire into `result-view.tsx` — read the component first; place SellSection near the outcome/routes area for closet (readOnly) pages only; it needs the scan's `result.cost.resale` and the fetched doc's `listingId`/`listingStatus` (closet fetch already returns the full doc — extend its local type).
- [ ] **Step 3:** Profile tiles: `SavedScan` gains `listingId?/listingStatus?`. Overlay tag top-left of garment card when present: active → "For Sale" (amber `#C9983E`), + `offerCount`>0 handled later, accepted → "Sale Pending", completed → "Sold" (green). Small pill `text-[10px] font-bold text-white rounded-full px-2 py-0.5`.
- [ ] **Step 4:** `bun test` + typecheck green. Manual check with `bun dev`.
- [ ] **Step 5:** Commit `feat(sell): instant evaluation flow and closet sale tags`.

---

## Phase 3 — Offers

### Task 8: Offer create/withdraw + retailer feed API

**Files:**
- Create: `app/api/retailer/listings/route.ts` (GET feed)
- Create: `app/api/listings/[id]/offers/route.ts` (POST)
- Create: `app/api/listings/[id]/offers/[offerId]/route.ts` (PATCH — `{action:'withdraw'}` by offer's retailer)
- Test: `__tests__/api/offers.test.ts`, `__tests__/api/retailer-feed.test.ts`

**Interfaces:**
- `GET /api/retailer/listings` (guard: `verifyApprovedRetailer`, else 403) → `{ listings: Array<{ id, garment, imageUrls, condition, createdAt, distanceKm: number | null }> }` — query `listings where status == 'active'`, strip `estimate/ownerUid/shipFrom/dropoffCode`, `distanceKm = haversineKm(store, approxLocation)` rounded 1 dp or null, sort ascending nulls-last then createdAt desc.
- `POST /api/listings/[id]/offers` (retailer guard) body `{ amountUsd: number, note?: string }`; amount integer 1–10 000, note ≤ 200 chars; 404 no listing; 409 listing not active; 409 if this retailer already has an `open` offer (query subcollection `where retailerUid == uid && status == 'open'`); batch: create offer `{ retailerUid, storeName, storeLat, storeLng, amountUsd, note?, status:'open', createdAt: serverTimestamp }` + `offerCount: FieldValue.increment(1)` on listing → 201 `{ offer }`.
- `PATCH .../offers/[offerId]` `{ action: 'withdraw' }`: 404 unless offer exists and `retailerUid === uid`; 409 unless status open; sets `withdrawn`.

- [ ] **Step 1:** Tests: feed 403 for null retailer; feed strips estimate and sorts by distance (two listings, farther first in fixture); offer 403 non-retailer; 409 non-active listing; 409 duplicate open offer; 201 batch commit; withdraw 409 on accepted offer.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS + full suite.
- [ ] **Step 5:** Commit `feat(offers): retailer feed, offer create/withdraw`.

### Task 9: Accept/decline + user offers UI

**Files:**
- Create: `app/api/listings/[id]/offers/[offerId]/accept/route.ts` (POST)
- Create: `app/api/listings/[id]/offers/[offerId]/decline/route.ts` (POST)
- Modify: `components/sell-section.tsx` (offers list + accept modal)
- Modify: `app/profile/page.tsx` (tag "Offer" when `offerCount > 0` on active — requires offerCount in mirror: accept via listing doc? Instead: `/api/user/scans` items already mirror listingStatus; ALSO mirror `offerCount` on the scan doc inside the offer-create batch: `batch.set(scanRef, { listingOfferCount: increment(1) }, {merge:true})` — scanRef = `users/{ownerUid}/scans/{scanId}` from listing doc)
- Test: `__tests__/api/accept-decline.test.ts`

**Interfaces:**
- `POST .../accept` (owner) body `{ fulfillment: 'dropoff' } | { fulfillment: 'ship', shipFrom: ShipFromAddress }` (shipFrom fields all required non-empty, zip regex). Guards: listing owner, listing `active`, offer `open` (else 409). Batch: offer → `accepted`; every other `open` offer → `declined`; listing → `{ status:'accepted', acceptedOfferId, acceptedRetailerUid: offer.retailerUid, acceptedAmountUsd: offer.amountUsd, fulfillment, acceptedAt: serverTimestamp, ...(dropoff ? { dropoffCode: generateDropoffCode() } : { shipFrom }) }`; mirror `listingStatus:'accepted'`. → 200 `{ dropoffCode? }`.
- `POST .../decline` (owner): open → declined, 409 otherwise.

- [ ] **Step 1:** Tests: accept auto-declines the other open offers (fixture with 3 offers, assert batch received declined updates for the 2 others); accept 409 when listing accepted; dropoff generates code matching regex; ship without shipFrom → 400; decline flips status.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** SellSection listed-state expansion: fetch `GET /api/listings/[id]` when `listingId` present; render offers (store name, `distanceKm` from storeLat/lng vs nothing — show amount `$N` big, note, Accept/Decline buttons). Accept opens modal: two option cards "Drop it off" (store name + "you'll get a pickup code") / "Ship it" (address form name/street1/city/state/zip). On success: show dropoff code prominently (`tracking-[0.3em] text-[28px] font-black`) or "Waiting for {store} to send your shipping label." Cancel-listing link ("Remove listing") calls PATCH cancel when still active.
- [ ] **Step 6:** Profile tag: active + `listingOfferCount > 0` → "Offer" pill (green-amber). Full suite + typecheck.
- [ ] **Step 7:** Commit `feat(offers): accept/decline with fulfillment and offers UI`.

### Task 10: Retailer dashboard (feed + offer form + deals tab)

**Files:**
- Create: `components/retailer/listing-feed.tsx`
- Create: `components/retailer/deals-tab.tsx`
- Modify: `app/retailer/page.tsx`
- Create: `app/api/retailer/deals/route.ts` (GET)

**Interfaces:**
- `GET /api/retailer/deals` (retailer guard) → `{ deals: Array<Listing-shaped minus estimate/ownerUid> }`: query `listings where acceptedRetailerUid == uid`, filter status `accepted|completed` in memory, sort acceptedAt desc. Includes `dropoffCode`, `shipFrom` (this retailer's own deals), `shipping`, `acceptedAmountUsd`.

- [ ] **Step 1:** Deals route + quick test (guard 403; estimate stripped).
- [ ] **Step 2:** `app/retailer/page.tsx` approved branch: heading "{storeName} — Partner Dashboard", tab switch (Listings / My Deals) via useState, `content-width` container.
- [ ] **Step 3:** `listing-feed.tsx`: fetch feed with bearer; card grid (`grid md:grid-cols-2 gap-4`): first image (plain `<img>` since Firebase Storage URLs, `object-contain` box), brand/category/condition/color, fiber string, distance badge ("2.3 km away"), inline offer form: `$` number input + note input + "Make offer" button → POST offer; on 201 swap form for "Offer sent — $N"; on 409 show its error message. Empty state: "No items listed nearby yet."
- [ ] **Step 4:** `deals-tab.tsx`: fetch deals; card per deal: garment summary, agreed `$N`, fulfillment badge. Dropoff: show the pickup code to match in store. Ship: if no `shipping` → "Send shipping label" button (wired Task 12; disabled with "waiting for customer address" if no shipFrom) ; if `shipping` → tracking number + label link. Always (status accepted): "Mark received" button (wired Task 12 route; POST `/api/listings/[id]/received`, optimistically flips card to Completed). Completed deals render muted with "Completed — ${finalAmountUsd}".
- [ ] **Step 5:** Suite + typecheck + manual dev-server look.
- [ ] **Step 6:** Commit `feat(retailer): dashboard with listing feed and deals`.

---

## Phase 4 — Shipping + completion

### Task 11: Shippo client

**Files:**
- Create: `lib/shippo.ts`
- Test: `__tests__/lib/shippo.test.ts`
- Modify: `lib/config.ts` (add `SHIPPO_TIMEOUT_MS = 20_000`)

**Interfaces:**
```ts
export type ShippoAddress = { name: string; street1: string; city: string; state: string; zip: string; country?: string; phone?: string };
export type PurchasedLabel = { labelUrl: string; trackingNumber: string; carrier: string };
export async function purchaseLabel(from: ShippoAddress, to: ShippoAddress, category: string | null): Promise<PurchasedLabel>
```
- `PARCEL_DEFAULTS`: map category → `{ length, width, height (in), weight (lb) }`; groups: outerwear (coat/jacket: 16×12×6, 2.5), shoes (14×10×6, 3), bottoms (jeans/pants/skirt: 12×10×4, 1.5), default tops (12×10×4, 1).
- Flow: `POST https://api.goshippo.com/shipments/` headers `{ Authorization: 'ShippoToken ' + process.env.SHIPPO_API_KEY }` body `{ address_from, address_to, parcels: [parcel], async: false }` → pick rate with lowest `parseFloat(amount)` (throw if none) → `POST /transactions/` `{ rate: rate.object_id, label_file_type: 'PDF', async: false }` → require `status === 'SUCCESS'` else throw joined `messages[].text` → `{ labelUrl: transaction.label_url, trackingNumber: transaction.tracking_number, carrier: rate.provider }`. Single attempt, no retry (money-moving). `AbortSignal.timeout(SHIPPO_TIMEOUT_MS)`.

- [ ] **Step 1:** Tests with global `fetch` mocked (`mock()` swapped onto `globalThis.fetch`, restored after): picks cheapest of 3 rates; throws with Shippo message on `status:'ERROR'`; throws when zero rates; category 'coat' produces 2.5 lb parcel in request body.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS + suite.
- [ ] **Step 5:** Commit `feat(shipping): shippo label purchase client`. Add `SHIPPO_API_KEY=` to README env block in this commit.

### Task 12: Label + received routes, user label download

**Files:**
- Create: `app/api/listings/[id]/label/route.ts` (POST)
- Create: `app/api/listings/[id]/received/route.ts` (POST)
- Modify: `components/retailer/deals-tab.tsx` (wire both buttons)
- Modify: `components/sell-section.tsx` (accepted+ship state: label download link once `shipping` present; poll not needed — refetch on mount)
- Test: `__tests__/api/label-received.test.ts`

**Interfaces:**
- `POST /api/listings/[id]/label` (retailer guard + must equal `acceptedRetailerUid`, else 404): 409 unless status `accepted` && fulfillment `ship` && no `shipping` yet; 400 `{ error: 'Waiting for the customer to add their address.' }` if no `shipFrom`; calls `purchaseLabel(shipFrom-as-ShippoAddress, storeAddress(from VerifiedRetailer, name=storeName, phone), listing.garment.category ?? null)`; on success update listing `{ shipping }` → 200 `{ shipping }`; on Shippo error → 502 `{ error }` (listing untouched, button retryable).
- `POST /api/listings/[id]/received` (accepted retailer): 409 unless status `accepted`; batch: listing `{ status:'completed', finalAmountUsd: acceptedAmountUsd, completedAt: serverTimestamp }` + mirror `listingStatus:'completed'` → 200.

- [ ] **Step 1:** Tests (mock `lib/shippo`): label 404 for other retailer; 400 missing shipFrom; 502 passthrough on purchase throw with no listing update; success stores shipping; received flips to completed with finalAmountUsd copied and mirror updated.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Wire deals-tab buttons (loading/error states inline) and SellSection "Download shipping label" link (`shipping.labelUrl`, opens new tab) + tracking number display.
- [ ] **Step 6:** Full suite + typecheck. Commit `feat(shipping): label purchase and deal completion`.

### Task 13: README + env documentation

**Files:**
- Modify: `README.md` (marketplace section: roles, listing flow, offers, Shippo, kickback-ledger note; add routes to the API table; `SHIPPO_API_KEY` env)

- [ ] **Step 1:** Write docs. **Step 2:** Commit `docs: resale marketplace`.

### Task 14: End-to-end verification pass

- [ ] **Step 1:** `bun test` — full suite green.
- [ ] **Step 2:** `bun run build` — clean production build (catches route typing / client-server boundary issues).
- [ ] **Step 3:** `bun dev` manual sweep: login toggle renders both modes; /retailer gates correctly for anonymous; closet detail shows Sell button; profile tags render (mock data acceptable where live Firestore/Shippo unavailable locally).
- [ ] **Step 4:** Fix anything found; final commit.
