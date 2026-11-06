---
name: verify
description: Launch the Rethread Next.js app locally and drive its web UI (scan a care label, read the result page, record an outcome) through the wmux browser pane, capturing page text, API responses and server logs as proof. Use to confirm a change works in the real app, not just in bun test.
---

# Verify Rethread

Primary surface: the web UI (Next.js 15, App Router). Secondary: the JSON API under `app/api/`, which curl can hit directly. The feature map is in [features/README.md](features/README.md).

All commands run from the repo root in Git Bash. `W` is the wmux CLI:

```bash
W="/c/Program Files/wmux/resources/cli-bin/wmux"   # bare `wmux` is only on PATH in wmux-spawned terminals
V="$TEMP/rethread-verify"                          # scratch: pid, dev log, evidence
```

If `"$W" ping` doesn't answer `pong`, there's no wmux browser. Use the chrome-devtools MCP tools instead (`new_page`, `take_snapshot`, `evaluate_script` with the same helper script).

## Launch

Use port 3107, not 3000, so you never drive the user's own `bun run dev`.

```bash
mkdir -p "$V"
curl -sf localhost:3107/api/health && echo "3107 already in use: run Doctor, don't launch a second one"
(bun run dev -- -p 3107 > "$V/dev.log" 2>&1 & echo $! > "$V/dev.pid")
for i in $(seq 1 60); do curl -sf localhost:3107/api/health && break; sleep 1; done
```

The server is ready when `/api/health` returns `{"status":"ok",...}`. The first page load compiles that route, which takes about 5 s, so give it a few seconds before driving.

**Keys.** The app reads `.env.local`, with the variables listed in `.env.example`.
- With no keys, the server still starts and a scan still finishes in degraded mode: no OCR, no Gemini, placeholder routes, and a lookup-table footprint.
- Login, closet, profile, retailer and admin need the Firebase vars.
- A full-fidelity scan needs `GOOGLE_APPLICATION_CREDENTIALS_BASE64`, `GEMINI_API_KEY` and `GOOGLE_MAPS_API_KEY`.
- On branches that store scans in Upstash Redis (from PR #23), it also needs `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or `POST /api/scan` returns 500.

Before you judge a result, check the server log to see which mode you're in:

```bash
grep -E '"level":"error"' "$V/dev.log" | tail   # "Missing GEMINI_API_KEY" etc. = degraded mode
```

## Doctor

Run this before the first drive and again after any drive that surprised you. It changes nothing.

```bash
curl -sf localhost:3107/api/health                       # server up
kill -0 "$(cat "$V/dev.pid")" 2>/dev/null && echo ours   # the instance on 3107 is the one we launched
"$W" ping                                                # browser pane reachable
"$W" browser open http://localhost:3107/scan && sleep 3 && "$W" browser snapshot | grep -c 'button "Scan"'   # 1 = UI rendered
```

If health is ok but `dev.pid` isn't alive, someone else owns 3107. Stop, and don't drive it.

## Drive

Get the page structure with `"$W" browser snapshot`. The stable handles are button names, which are visible text, and routes. None of the elements have `data-testid` attributes.

**Scan, using the real upload path.** `scripts/stage-scan.js` draws a synthetic care label ("100% COTTON / MADE IN BANGLADESH") and a garment photo on a canvas. It puts them into the page's two real `<input type=file>` elements and fires `change`, which runs the same handler a user's file picker does. Then it clicks **Scan**.

```bash
"$W" browser open http://localhost:3107/scan && sleep 4
"$W" browser eval "$(cat .claude/skills/verify/scripts/stage-scan.js)"     # → "OK: staged ... clicked Scan"
for i in $(seq 1 60); do u=$("$W" browser eval "location.pathname"); echo "$u" | grep -q '/result/' && break; sleep 2; done; echo "$u"
```

- Reaching `/result/<uuid>` within 2 minutes is a pass.
- If the loop times out, the scan failed. A failed scan sends the page back to `/scan`, so you can't poll for `/scan` itself: you're already on it when you click. Read the error with `"$W" browser eval "sessionStorage.getItem('scan:error')"`, and check `"$V/dev.log"`.

**API directly** (for side effects, or when there's no browser):

```bash
curl -s localhost:3107/api/scan/<uuid>                  # stored scan; 404 after the 30-min TTL
curl -s -F photo=@label.jpg localhost:3107/api/scan     # same endpoint the UI posts to; fields: photo (1-3), garment_photo, lat, lng
```

The rate limit is 5 requests per minute per IP across the limited routes. A sixth scan within the same minute gets a 429, which comes from the limiter, not a bug.

## Evidence

Save each proof to `$V/evidence/<run-name>/`. Cleanup never deletes that folder.

```bash
E="$V/evidence/$(date +%Y%m%d-%H%M%S)-<feature>"; mkdir -p "$E"
"$W" browser get-text > "$E/page.json"                   # what the user sees
curl -s localhost:3107/api/scan/<uuid> > "$E/api.json"   # stored state behind it
grep traceId "$V/dev.log" > "$E/server-log.jsonl"         # which pipeline stages ran or fell back
"$W" browser screenshot                                  # optional: fails while the wmux window is minimized
```

What counts as proof:
- Drive the real UI path. Don't write `scan:pending` or `scan:<id>` into sessionStorage yourself.
- Capture both the action (the helper's `OK:` line) and the end state (the page text plus the API JSON).
- Check side effects as well as the screen: the stored scan from `GET /api/scan/<id>`, and Firestore totals for signed-in outcomes.
- Say which mode the run was in, degraded or keyed, based on the server log. A degraded-mode pass proves the wiring, not the analysis.

## Cleanup

Kill only what you launched. `bun run dev` spawns a `next` child process, so kill the process tree that owns the port, and only if it's ours:

```bash
P=$(netstat -ano | grep -E ':3107 .*LISTENING' | awk '{print $NF}' | head -1)
[ -n "$P" ] && kill -0 "$(cat "$V/dev.pid")" 2>/dev/null && taskkill //PID "$P" //T //F
kill "$(cat "$V/dev.pid")" 2>/dev/null; rm -f "$V/dev.pid"
curl -sf localhost:3107/api/health || echo "3107 down"
ls "$V/evidence"                                          # evidence must survive
```

Never `taskkill //IM node.exe`: that kills the user's other Node processes too. `.next/` is gitignored build output, so leave it alone.

## Helpers

- `scripts/stage-scan.js` is evaluated in the page. Run it as `"$W" browser eval "$(cat .claude/skills/verify/scripts/stage-scan.js)"` on `/scan`. It returns `OK: ...` or `FAIL: <reason>`. To change the label text it OCRs, edit the array of strings in the file.
