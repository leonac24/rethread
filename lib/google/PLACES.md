## Purpose

Stage 3 of the scan pipeline: given a user's coordinates and a garment category, return one nearest repair, resale, and donation option.

## API

```ts
findRoutes(
  lat: number,
  lng: number,
  category: string | null,
): Promise<[RouteOption, RouteOption, RouteOption]>
```

- `lat`, `lng` — user's location in decimal degrees.
- `category` — the garment's category string from the `Garment` object (e.g. `"top"`, `"shoe"`). `null` is tolerated and treated as "accept anything".
- Returns a fixed 3-tuple in order: `[repair, resale, donation]`. Each `RouteOption` carries `kind`, `name`, `address`, `distance_km`, optional `hours` and `rating`, and `accepts_item: boolean | null` (`null` means we can't tell). See `types/garment.ts`.

## How it works

- Fires three Places API (New) `places:searchText` requests in parallel, one per `RouteKind`, each with a fixed text query (`"clothing repair tailor"`, `"consignment thrift store"`, `"clothing donation center"`).
- Each request sends a `locationRestriction` circle centered on the user with a 5 km radius, `maxResultCount: 1`, and `rankPreference: 'DISTANCE'` — `locationRestriction` is required for distance ranking to apply.
- Response fields are pinned via `X-Goog-FieldMask` to displayName, formattedAddress, location, rating, types, and weekday opening descriptions; the description for today's weekday is picked off the list (Places indexes 0 = Monday).
- Distance is recomputed locally from the returned lat/lng with the haversine formula and rounded to one decimal kilometre — the API is only trusted for ranking.
- `accepts_item` cross-checks the place's reported `types` against a small whitelist picked from the category. Shoe-ish categories (regex `/shoe|sneaker|boot|sandal|heel|loafer|slipper|pump|oxford|clog/`) match `shoe_store`/`clothing_store`/`department_store`/`shopping_mall`; everything else swaps `shoe_store` for `tailor`. Donation routes return `null` (place types rarely distinguish donation centers); a null category returns `true`.

## Environment

- `GOOGLE_MAPS_API_KEY` — a Google Cloud API key with **Places API (New)** enabled. Server-side only.

## Failure modes

- Throws `GOOGLE_MAPS_API_KEY not set` if the env var is missing.
- Throws `No <kind> place found near <lat>,<lng>` if Places returns zero results for any of the three categories. The whole tuple fails — there is no partial result.
- A non-2xx Places response throws `Places searchText failed for <kind>: <status>`.
