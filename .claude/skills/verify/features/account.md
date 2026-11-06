# Account: login, closet, profile, leaderboard

Users sign in with Google through Firebase Auth. Signed-in users get a closet of past scans (`/closet/<scanId>`), a profile with running CO₂ and water totals and a rank tier (`/profile`), and a place on the leaderboard (`GET /api/leaderboard`).

## Sub-features

- **Sign in**, from the header link to `/login` (Google OAuth popup).
- Closet list and the per-scan detail page.
- Profile totals and rank tier.
- Leaderboard. This one is public, with no auth needed.

## How to get to it (user POV)

Click **Sign in** in the header, then finish the Google popup. Then go to `/profile` or `/closet`.

## Driving it with wmux browser

```bash
curl -s localhost:3107/api/leaderboard          # public; needs Firebase admin vars to return data
"$W" browser open http://localhost:3107/login && "$W" browser snapshot
```

The Google OAuth popup needs a real person to sign in. Have the user sign in once in the wmux pane, then drive `/profile` and `/closet` from that session.

## Gotchas

- Unreachable without the `NEXT_PUBLIC_FIREBASE_*` and `FIREBASE_SERVICE_ACCOUNT_BASE64` vars, plus a Google account the user signs in with. Report it as `verified-unreachable` with that prerequisite.
- Not yet driven live.
