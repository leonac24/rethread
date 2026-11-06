# Retailer marketplace and admin approval

Users who chose **List / Swap** create listings. Retailers apply at `/retailer` (`POST /api/auth/callback` with a `retailer` body), an admin approves them at `/admin`, and approved retailers browse listings, make offers (`/api/listings/<id>/offers`), buy shipping labels through Shippo (`/api/listings/<id>/label`) and mark items received.

## Sub-features

- Retailer application. The status starts as `pending`.
- Admin list of pending applications (`GET /api/admin/retailers`) and approval (`POST /api/admin/retailers/<uid>/approve`).
- Listing feed, offers (create, accept, decline), shipping label, and received.
- Retailer deals and listings (`/api/retailer/deals`, `/api/retailer/listings`).

## How to get to it (user POV)

Sign in, open `/retailer`, and submit the store details. Then an admin opens `/admin` and approves the store. After that the retailer sees the listings feed on `/retailer`.

## Driving it with wmux browser

```bash
"$W" browser open http://localhost:3107/admin && "$W" browser snapshot
curl -s localhost:3107/api/admin/retailers      # currently answers with no auth (known security bug)
```

## Gotchas

- Needs Firebase and a signed-in user. Making a label needs a Shippo key and spends real money, so never buy a label during verification.
- The admin routes don't check auth at the moment. That's a product security bug. Report it, and don't add a "requires admin" note to the map until the code actually enforces it.
- Not yet driven live.
