# Result page and outcome

`/result/<uuid>` shows the garment, its environmental impact, the dye risk, the brand's Fashion Transparency Index, three routes (donation, resale, repair), and **WHAT WILL YOU DO WITH IT?**. Choosing an outcome posts to `POST /api/scan/<id>/outcome`. Signed-in users also upload their images (`POST /api/scan/<id>/images`) and get their CO₂ and water totals incremented in Firestore.

## Sub-features

- Outcome buttons: **Donate** ("Give it away"), **List / Swap** ("Sell or trade"), **Repair** ("Extend its life"), **Throw Away** ("Sends to landfill").
- First outcome wins. A second submit for the same scan gets a 409.
- **— CARE LABEL OCR —** shows the raw OCR text, which is empty when Vision isn't available.

## How to get to it (user POV)

Finish a scan (see [scan.md](scan.md)). The app takes you to `/result/<uuid>` on its own. Scroll to **WHAT WILL YOU DO WITH IT?** and press a button.

## Driving it with wmux browser

```bash
"$W" browser snapshot | grep -E 'button "(Donate|List / Swap|Repair|Throw Away)'
"$W" browser click <eN for Donate>
"$W" browser get-text                                          # confirmation state
curl -s -X POST localhost:3107/api/scan/<uuid>/outcome -H 'content-type: application/json' -d '{"action":"donate"}'   # expect 409 after the UI submit
```

End state that proves it:
- The page shows a confirmation.
- A repeat POST returns 409 (the outcome was stored).
- When signed in, the user's totals on `/profile` went up by the scan's CO₂ and water.

## Gotchas

- Not yet driven live. The first maintenance pass should confirm the confirmation text and the outcome request body.
- An anonymous outcome is stored but earns no credit. If you sign in and retry, you get a 409, not the credit.
- If the Firestore write fails, the route still returns 200, but the totals don't move. Check `/profile`, not just the response.
- Scans expire after 30 minutes. An old `/result/<uuid>` falls back to sessionStorage, and its outcome POST returns 404.
