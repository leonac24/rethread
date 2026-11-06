# Scan a care label

The user uploads a garment photo and 1–3 care-label photos and presses **Scan**. A loading screen runs while `POST /api/scan` works through the pipeline: Vision OCR, then Gemini parsing, then the LCA lookup, then WikiRate, then Places. When it finishes, the user lands on `/result/<uuid>`.

## Sub-features

- Garment photo, single file (the first file input, **Upload Garment**). Needed to enable Scan.
- Tag photos, up to 3 (the second file input, **Upload Tags**). Each one can be removed with its **×** button.
- Location: the scanning view asks for geolocation and sends `lat`/`lng` if the user grants it.
- Fallbacks: if Vision fails, the scan uses no text. If Gemini fails, it uses the regex label parser. If Places fails, it shows placeholder routes. The scan still finishes in each case.

## How to get to it (user POV)

Go to Home, then the scan entry point, then `/scan`. Pick the files, then press **Scan N images**. The `/scanning` loading screen appears, then `/result/<uuid>`.

## Driving it with wmux browser

```bash
"$W" browser open http://localhost:3107/scan && sleep 4
"$W" browser eval "$(cat .claude/skills/verify/scripts/stage-scan.js)"
# poll location.pathname until it contains /result/ (pass); on a 2-min timeout read sessionStorage 'scan:error' (fail)
```

End state that proves it:
- `location.pathname` is `/result/<uuid>`.
- `browser get-text` shows GARMENT, ENVIRONMENTAL IMPACT, NEXT ROUTES and WHAT WILL YOU DO WITH IT?
- `curl localhost:3107/api/scan/<uuid>` returns the same `id`.
- With keys, also check that the parsed fibers include cotton and the origin is Bangladesh. With no keys, check that `garment.fibers` is `[]`.

## Gotchas

- With no keys, the result shows a footprint of 200 L / 2.4 kg (53 gal / 5.3 lb) for "Unknown", and nothing marks it as a placeholder. Every route reads "Location not provided · 0.0 mi". That is the current app behavior, a known product bug, not a harness failure.
- The Scan button's label changes from "Scan" to "Scan 2 images" once files are staged. Match on the prefix.
- The routes always show in the order donation, resale, repair, whatever the garment's condition, because `components/result-view.tsx` re-sorts them. Don't record that as passing "condition-based ordering".
- After 5 scans in a minute you get a 429. Wait 60 s.
