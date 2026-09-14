# Rethread diagrams

Architecture and flow diagrams for the scan → outcome pipeline, generated with gstack `/diagram`.

Each diagram is a **triplet** (plus source):

| File | Use |
|---|---|
| `<name>.mmd` | Mermaid source — the source of truth. Edit this and re-render. |
| `<name>.svg` | Crisp vector for docs. |
| `<name>.png` | Raster for READMEs / chat / issues. |
| `<name>.excalidraw` | Editable scene — open at [excalidraw.com](https://excalidraw.com) (File → Open), move boxes, keep working. |

## The set

| Diagram | What it shows |
|---|---|
| [`rethread-scan-outcome-flow`](./rethread-scan-outcome-flow.png) | **Overview** — end to end, `/scan` → pipeline → `/result` → outcome recording. Start here. |
| [`rethread-client-capture`](./rethread-client-capture.png) | Browser capture & handoff: CameraScan → compress + `scan:pending` → ScanningView → POST, with the error-replay bounce back to `/scan`. |
| [`rethread-scan-pipeline`](./rethread-scan-pipeline.png) | `POST /api/scan` server pipeline: rate-limit → validation → ingest (OCR + Gemini, regex fallback) → 4-way parallel enrich (each with its degradation) → save. |
| [`rethread-outcome-recording`](./rethread-outcome-recording.png) | `POST /api/scan/:id/outcome`: id + rate-limit + action validation → `recordOutcome` (404/409) → auth check → Firestore credit (graceful commit failure). |
| [`rethread-outcome-state-machine`](./rethread-outcome-state-machine.png) | `OutcomeSection` client UI states: idle → confirming (throw away) → loading → done / conflict / error, with the retry loop. |

## Color legend

Shared across every diagram:

| Color | Meaning |
|---|---|
| 🟦 Blue | Client / browser |
| 🟩 Green | Server (Next.js route handler) |
| 🟨 Amber | External API (Gemini, Vision, Places, WikiRate, BigQuery) |
| 🟪 Purple | Data store (sessionStorage, scan-store, Firestore) |
| 🟡 Yellow | Decision |
| 🟥 Red | Reject / error response |
| 🌹 Rose | Graceful fallback |

## Editing / regenerating

- **Edit the `.mmd`** and re-render with gstack `/diagram` — the mermaid source is authoritative.
- Or edit the **`.excalidraw`** at excalidraw.com and re-render from the edited scene.
- Flowcharts (`graph LR/TD`) stay box-by-box editable in excalidraw. Avoid `subgraph` — it breaks the excalidraw converter.
- For PDFs, embed the ` ```mermaid ` fence directly (gstack `/make-pdf` renders it natively) rather than the PNG.
