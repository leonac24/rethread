# Theme — `Wave Index`

> An editorial, film-grain, sky-leaning design system.
> Synthesized from the `aesthetic/` mood board and married to VSCO's content-first, minimal UI philosophy.

---

## 1. Design Philosophy

**Content is the hero. Chrome is a whisper.**

The interface behaves like the margin of a printed magazine: imagery fills the page, typography is small, precise, and confident, and every surrounding element (labels, rules, metadata) is quiet enough to disappear until needed. Borrowed from VSCO: generous whitespace, monochrome chrome, zero ornamentation. Borrowed from the mood board: analog grain, editorial labeling, serif display accents, and sky-washed color.

**Three rules, never broken:**
1. Photo/content first — UI recedes.
2. One accent at a time — never two competing colors on one screen.
3. If it isn't a rule, a label, or a verb, it shouldn't be on screen.

---

## 2. Color System

All values are semantic tokens. Never hardcode hex in components.

### Core Palette (Light)

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#F4F1EA` | Page background — warm paper cream |
| `--surface` | `#FBF9F4` | Cards, sheets, inputs |
| `--surface-sunk` | `#ECE8DF` | Subtle recessed fills |
| `--ink` | `#14161A` | Primary text, icons, rules |
| `--ink-muted` | `#5C6470` | Secondary text, captions |
| `--ink-faint` | `#A6ADB6` | Disabled, metadata, tertiary |
| `--rule` | `#1416141A` | Hairline borders (`#141614` @ 10%) |

### Accent — "Wave Blue" (primary)

| Token | Hex | Role |
|---|---|---|
| `--accent-50` | `#EAF4FB` | Tint, hover wash |
| `--accent-200` | `#BEDDF0` | Chips, inactive fills |
| `--accent-500` | `#6FA8CE` | Default accent, links, active tab |
| `--accent-700` | `#2E5F83` | Pressed, strong headers |
| `--accent-900` | `#13324A` | Text on accent tints |

> Drawn from the `ESCAPE` and `CLOUD` covers — the soft sky between a washed-out photograph and a printed page.

### Semantic

| Token | Hex | Role |
|---|---|---|
| `--success` | `#5E8B6C` | Sage — from the `ESCAPE` foliage |
| `--warning` | `#C8A24A` | Warm ochre — from `KEEP ON DREAMING` type |
| `--danger` | `#B23A2B` | Muted vermillion — from `BEATS SOLO 4` |
| `--info` | `var(--accent-500)` | Same as primary accent |

### Dark Mode

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0D1014` | Deep slate — not pure black |
| `--surface` | `#161A21` | Cards |
| `--surface-sunk` | `#0A0D11` | Recessed |
| `--ink` | `#ECE8DF` | Primary text (warm, not white) |
| `--ink-muted` | `#8A919C` | Secondary |
| `--rule` | `#ECE8DF1F` | Hairline @ 12% |
| `--accent-500` | `#8EC2E0` | Lifted sky blue for dark bg contrast |

**Dark mode is co-designed, not inverted.** Verify 4.5:1 contrast independently.

---

## 3. Typography

A two-voice system: an editorial serif for display moments, a neutral sans for everything else, and a compact mono for metadata chips — echoing the magazine mastheads in the mood board.

### Families

| Role | Font | Fallback |
|---|---|---|
| Display (serif) | **Fraunces** — variable, softened contrast | `'Playfair Display', 'Times New Roman', serif` |
| UI (sans) | **Inter** — neutral, excellent at small sizes | `'Helvetica Neue', system-ui, sans-serif` |
| Metadata (mono) | **JetBrains Mono** — tight, engineer-editorial | `'IBM Plex Mono', monospace` |

> VSCO-alike: if Fraunces feels too expressive for a given screen, substitute a single weight of Inter at the display size. Restraint over flourish.

### Type Scale (8pt base, 1.25 ratio)

| Token | Size / Line | Usage |
|---|---|---|
| `display-xl` | 56 / 60, Fraunces 400, tracking −2% | Hero only, once per screen |
| `display-lg` | 40 / 44, Fraunces 400, tracking −1.5% | Section opener |
| `display-md` | 28 / 32, Fraunces 500 | Card title (editorial) |
| `title-lg` | 22 / 28, Inter 600 | Page title (functional) |
| `title-md` | 18 / 24, Inter 600 | Card/row title |
| `body-lg` | 16 / 24, Inter 400 | Default body |
| `body-md` | 14 / 20, Inter 400 | Secondary body |
| `caption` | 12 / 16, Inter 500, tracking +4% UPPERCASE | Labels, tabs, chips |
| `meta` | 11 / 14, JetBrains Mono 400, tracking +2% | Timestamps, IDs, `NO.264`-style metadata |

**Rules:**
- Body text minimum 16px on mobile.
- Never stack two display styles on one screen.
- Captions are always uppercase, always tracked. This is the aesthetic's signature.
- Mono meta is the only place numbers appear; use tabular figures.

---

## 4. Spacing, Radius, Rules

### Spacing — 8pt scale

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96`

Use `16` as baseline padding, `24` between related groups, `48+` between sections.

### Radius

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | `2px` | Chips, tags, small inputs — sharp, editorial |
| `--radius-md` | `6px` | Buttons, cards |
| `--radius-lg` | `12px` | Sheets, modals |
| `--radius-full` | `9999px` | Avatars, pills (reserved — not default) |

> Corners stay small. The mood board is built on rectangles and printed rules; pill-shaped everything kills the editorial feel.

### Rules (borders)

- Hairline only: `1px solid var(--rule)`.
- Never use a border thicker than 1px except on a focused input (2px `--accent-500`).
- Use rules to frame metadata blocks and tables — directly from the `ESCAPE` / `CLOUD` covers.

### Elevation

Minimal. Three levels, no more.

| Token | Shadow |
|---|---|
| `--elev-0` | `none` (default — lean on rules, not shadow) |
| `--elev-1` | `0 1px 2px rgba(20,22,26,0.06), 0 0 0 1px var(--rule)` |
| `--elev-2` | `0 8px 24px rgba(20,22,26,0.08)` — modals, dropdowns |

---

## 5. Texture & Effects

The mood board's analog feel comes from three things. Use them **sparingly and only where appropriate**.

1. **Grain overlay** — a seamless 1% opacity noise PNG or SVG feTurbulence, applied globally to `<body>::after` with `pointer-events: none`. Gives every screen the printed-paper quality seen in `ESCAPE`.
2. **Halftone accent** — a CSS `radial-gradient` dot pattern reserved for empty states and hero backgrounds. Not on every screen.
3. **Soft vignette** — 8% dark radial fade at viewport edges for full-bleed imagery.

**Never use:** neon glow, glassmorphism blur, heavy drop shadows, gradient buttons, emoji as icons.

---

## 6. Iconography

- **Library:** Lucide (1.5px stroke) — matches Inter's neutrality.
- **Size tokens:** `icon-sm 16px · icon-md 20px · icon-lg 24px`.
- **Style:** outline only, one stroke width across the entire product. No filled icons except for a currently-selected tab indicator.
- **Color:** inherit `currentColor`. Icons are ink, not accent.

---

## 7. Components

### Buttons

Three variants. That's it.

- **Primary** — solid `--ink` background, `--bg` text, `--radius-md`, 44px min height. One per screen.
- **Secondary** — transparent, `1px solid --rule`, `--ink` text.
- **Ghost** — no border, `--ink-muted` text, underline on hover.

Pressed state: 96% scale + 50ms ease-out. No color shift.

### Cards

White (`--surface`) on cream (`--bg`), hairline rule, no shadow by default. Title in `title-md`, metadata chip in `meta` mono in the top-right corner — the `NO.264` / `WAVE INDEX` pattern from the mood board.

```
┌──────────────────────────── NO.001 ─┐
│  [ image ]                          │
│                                     │
│  Section Label                      │
│  Card title in serif or sans        │
│  Short supporting body line.        │
└─────────────────────────────────────┘
```

### Inputs

Flat. No rounded pill. `--radius-sm`, `1px solid --rule`, focus ring is a 2px `--accent-500` border replacing the hairline (no outer glow). Label sits above the input in `caption` style.

### Tabs

Text-only, tracked uppercase `caption`, 1px underline on active. No background fill, no pill. Inherits directly from VSCO.

### Image tiles (gallery)

Edge-to-edge, 1px `--rule` gap between tiles. No rounded corners on gallery tiles — they are photos, not cards. Tap feedback is an 80ms opacity dip to 0.85.

### Metadata chip

The signature component. Used for tags, dates, edition numbers.

```
[ NO.264 ]    [ 11·DEC·2024 ]    [ 平和 ]
```

- Mono `meta` type, uppercase
- `1px solid --rule`, `--radius-sm`, `4px 8px` padding
- Transparent background
- Never more than 3 on one screen

---

## 8. Motion

Restrained. All animation is purposeful; decoration is forbidden.

| Token | Value |
|---|---|
| `--duration-fast` | 120ms — taps, press feedback |
| `--duration-base` | 200ms — hover, tab change |
| `--duration-slow` | 320ms — sheets, modals |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| `--ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` |

**Rules:**
- Enter with ease-out, exit with ease-in, exit ~70% of enter duration.
- Only `transform` and `opacity` — never width/height/top/left.
- Respect `prefers-reduced-motion` — disable all non-essential motion.
- Maximum two animated elements per view.

---

## 9. Layout

- **Grid:** 12-column on desktop with 24px gutters; single-column with 16px gutters on mobile.
- **Max content width:** 1200px. Center with generous side margins; do not stretch edge-to-edge on desktop except for hero imagery.
- **Breakpoints:** `375 · 768 · 1024 · 1440`.
- **Safe areas:** Always respect notch, home indicator, Dynamic Island on mobile.
- **Vertical rhythm:** All vertical spacing is a multiple of 8. Sections separated by `48` or `64`.

---

## 10. Voice & Microcopy

Match the visual restraint.

- Sentence case for UI buttons and labels, **UPPERCASE + tracked** only for `caption` chips.
- One verb per button. "Save," not "Save changes now."
- Empty states get one serif line + one sans subline. Nothing more.
- Timestamps and numeric metadata are always in mono.
- Optional: a single small CJK glyph (e.g., 平和, 夢) in a metadata chip per major section — a quiet nod to the mood board, used once per screen at most.

---

## 11. Anti-Patterns — Do Not

- Do **not** use emoji as functional icons.
- Do **not** mix more than one accent color on a single screen.
- Do **not** apply rounded-full corners to cards or buttons (breaks editorial feel).
- Do **not** add gradients to buttons or text.
- Do **not** use drop shadows as a primary elevation cue — use hairline rules first.
- Do **not** animate for decoration. If it doesn't signal cause/effect, remove it.
- Do **not** let body text fall below 16px on mobile.
- Do **not** stack two display type sizes on one screen.
- Do **not** apply grain to solid UI surfaces at above 2% opacity — it degrades text contrast.
- Do **not** invert light mode to get dark mode.

---

## 12. Quick Reference — Token Cheatsheet

```css
:root {
  /* Color — Light */
  --bg:            #F4F1EA;
  --surface:       #FBF9F4;
  --surface-sunk:  #ECE8DF;
  --ink:           #14161A;
  --ink-muted:     #5C6470;
  --ink-faint:     #A6ADB6;
  --rule:          rgba(20, 22, 26, 0.10);

  --accent-50:     #EAF4FB;
  --accent-200:    #BEDDF0;
  --accent-500:    #6FA8CE;
  --accent-700:    #2E5F83;
  --accent-900:    #13324A;

  --success:       #5E8B6C;
  --warning:       #C8A24A;
  --danger:        #B23A2B;

  /* Type */
  --font-display:  'Fraunces', 'Playfair Display', serif;
  --font-ui:       'Inter', system-ui, sans-serif;
  --font-mono:     'JetBrains Mono', 'IBM Plex Mono', monospace;

  /* Space */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-6: 24px; --space-8: 32px;
  --space-12: 48px; --space-16: 64px; --space-24: 96px;

  /* Radius */
  --radius-sm: 2px;
  --radius-md: 6px;
  --radius-lg: 12px;

  /* Motion */
  --duration-fast: 120ms;
  --duration-base: 200ms;
  --duration-slow: 320ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in:  cubic-bezier(0.7, 0, 0.84, 0);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg:           #0D1014;
    --surface:      #161A21;
    --surface-sunk: #0A0D11;
    --ink:          #ECE8DF;
    --ink-muted:    #8A919C;
    --rule:         rgba(236, 232, 223, 0.12);
    --accent-500:   #8EC2E0;
  }
}
```

---

## 13. Source Synthesis

| Image | Contribution |
|---|---|
| `ESCAPE / 平和` (magazine cover) | Primary sky-blue accent, cream paper background, serif display masthead, hairline framing, CJK metadata accent |
| `CLOUD / floating` | Secondary blue palette, editorial label blocks, barcode-style metadata chips, framed text column layout |
| `KEEP ON DREAMING` | Warm ochre warning accent, serif-display-with-glyph-swap pattern for hero only, soft vignette over full-bleed imagery |
| `PEOPLE CARE ABOUT APPEARANCES` | Grain/halftone texture philosophy, typographic density as visual rhythm, grid overlay as empty-state pattern |
| `BEATS SOLO 4` | Muted vermillion danger accent, sharp `radius-sm` rectangles, mono-tracked vertical side labels |
| **VSCO** (external reference) | Content-first minimalism, generous whitespace, monochrome chrome, restraint in animation, gallery-tile navigation, tracked uppercase tabs |

The through-line: **print made interactive, without losing its silence.**
