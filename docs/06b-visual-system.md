# 06b · Visual System — "Control Ledger"

> Produced by invoking `ui-ux-pro-max` on 2026-04-22, then synthesized against our constraints in [06](./06-ui.md). This file is the authoritative design token source; `apps/web/tailwind.config.ts` must mirror it.

## 1. Direction

**Control Ledger.** The UI is an operator's console + a running ledger of operations. Every Turn in the conversation is a ledger entry. No marketing affordances.

**Signature element** — each Turn has a **2 px vertical accent rail** on the far-left of the stacked cards, color-coded to the Turn's semantic state (read-ok / write-pending / danger / rejected / error / llm). Combined with a **git-log-style metadata header** above the cards (`abcd123 · 2026-04-22 13:42 · alice · k8s/prod`), the conversation reads like a tailed commit log — data as decoration.

## 2. Color Tokens

All tokens in both themes. No gradients, no color-mix decorations. Hex values are tested for WCAG AA on each background they pair with.

### 2.1 Dark (default)

| Token | Value | Usage |
| --- | --- | --- |
| `--canvas`          | `#0B0E13` | App background |
| `--surface`         | `#10141B` | ContextBar, CommandBar, card body |
| `--elevated`        | `#161B25` | Row hover, completion popover, LLM summary base |
| `--border-subtle`   | `#1D232D` | 1 px dividers inside a card |
| `--border`          | `#2A313E` | 1 px card outline |
| `--text-primary`    | `#E6EAF1` | Body text, values |
| `--text-secondary`  | `#A1A9B8` | Labels, metadata |
| `--text-muted`      | `#6B7383` | Placeholder, kicker |
| `--ok`              | `#4CB27E` | Read success · running pod · applied |
| `--write`           | `#DD8A3E` | Write skill color · PlanCard rail · `WRITE` chip |
| `--danger`          | `#E54B57` | Destructive rail · `DANGER` chip · error underline |
| `--warn`            | `#E8C44D` | Caution · PartialSuccess · divergence strip |
| `--pending`         | `#6F8CB5` | Awaiting approval · skeleton shimmer base |
| `--llm`             | `#C8A46B` | Gemini summary block rail + badge. Reserved. |
| `--focus`           | `#5EA0FF` | Focus ring (not used as a state color) |

### 2.2 Light

| Token | Value | Usage |
| --- | --- | --- |
| `--canvas`          | `#F7F8FA` | |
| `--surface`         | `#FFFFFF` | |
| `--elevated`        | `#F1F3F7` | |
| `--border-subtle`   | `#E6E8EE` | |
| `--border`          | `#D0D4DC` | |
| `--text-primary`    | `#0B0E13` | |
| `--text-secondary`  | `#4B5462` | |
| `--text-muted`      | `#8A92A0` | |
| `--ok`              | `#137A45` | darker green for contrast on white |
| `--write`           | `#B5661F` | darker orange |
| `--danger`          | `#C02632` | darker red |
| `--warn`            | `#A07A12` | darker honey |
| `--pending`         | `#3B5B84` | |
| `--llm`             | `#8A6A30` | warm tan |
| `--focus`           | `#1D6FE0` | |

### 2.3 Rules

1. Functional color ≠ only signal — every state also carries a glyph (●, ✕, ✓) and a text chip.
2. `--llm` is **reserved**. No non-LLM surface may use `--llm`. This is how the user knows at a glance "this text came from a model".
3. Chips use 10 % tinted fill of their hue with 40 % border of same hue: `bg-[--ok]/10 border-[--ok]/40 text-[--ok]`.
4. Row-level selection uses `--elevated` background + 2 px `--focus` left stripe.

## 3. Typography

Fonts (already wired): **Geist Sans** (UI chrome), **Geist Mono** (command text, token coloring, result data, cell values, log streams). Tabular numerics on `font-variant-numeric: tabular-nums` by default for data columns, latency cells, row counts.

| Step  | Size / Line-height | Weight | Usage |
| --- | --- | --- | --- |
| `caption`   | 11 / 14 | 500, **UPPERCASE**, tracking 0.08em | Kicker labels, chip text |
| `small`     | 12 / 16 | 400 | Metadata, secondary row text |
| `body`      | 13 / 20 | 400 | Default body, card body, completion list |
| `lead`      | 15 / 22 | 500 | StatusLine row (important), Plan effect summary |
| `mono-body` | 13 / 20 | 400 mono | Command tokens, values |
| `mono-bar`  | 14 / 22 | 400 mono | CommandBar input |
| `section`   | 17 / 24 | 600 | Section titles (rare — PlanCard, ApprovalCard) |
| `hero`      | 20 / 28 | 600 | Empty state opening line (once per app) |

## 4. Spacing · Radius · Border

Grid is **4 px base**. Scale: `space-1=4 · 2=8 · 3=12 · 4=16 · 5=20 · 6=24 · 8=32 · 10=40 · 12=48 · 16=64`.

Radius: `sm=4 · md=6 · lg=10 · pill=9999`. Default for cards = **6 px**. Chips = 4 px. Nothing exceeds 10 px.

Border: always 1 px. No 2 px outlines. 2 px reserved for the accent rail only (see §5).

## 5. Card Anatomy (all cards)

All cards share a common shell:

```
┌──────────────────────────────────────────────────────────────┐
│▐ ┃ commit_hash · time · user · profile                       │ ← 24 px metadata header, caption style, text-muted
│▐ ┃                                                            │
│▐ ┃  <content, padding 16 px top/bottom, 20 px left/right>     │
│▐ ┃                                                            │
└──────────────────────────────────────────────────────────────┘
 │
 └── 2 px rail, color by card kind (see table below). Extends top→bottom of the card.
```

- Gap between cards **inside the same Turn**: 0 px (cards sit directly on top of each other, only the 1 px `--border-subtle` divider separates them).
- Gap between Turns: 24 px.
- Max width: 960 px centered if viewport ≥ 1440 px; full width below.
- All cards have `bg-[--surface]` and `border-[--border-subtle]` on 4 edges. Corner radius 6 px. No shadow.

### 5.1 Rail colors

| Card kind | Rail color |
| --- | --- |
| `UserCommandRow`             | `--text-muted` (grey, signals "prompt") |
| `ResultCard` (read ok)       | `--ok` |
| `ResultCard` (error)         | `--danger` |
| `PlanCard`                   | `--write` |
| `ApprovalCard` (normal)      | `--write` |
| `ApprovalCard` (danger: true)| `--danger`, plus a **top stripe** (4 px) in `--danger` too |
| `RunCard` (streaming)        | animated — slow pulse between `--pending` and `--ok` over 1.2 s |
| `RunCard` (done)             | `--ok` |
| `ErrorCard`                  | `--danger` |
| `LLM·summary block`          | `--llm` (**this is the only `--llm` use**) |
| `Rejected` (final state)     | `--text-muted` (grey, signals "void") |

### 5.2 UserCommandRow

```
┃ >_  /infra aws vm list --region us-east-1
```
28 px tall, single line. Left-gutter icon `lucide:chevron-right-square` 14 px `text-muted`. Mono body 13 px. No metadata header (it is itself the header of the Turn; the metadata appears below on the first result card).

### 5.3 ResultCard — table variant

- Header row 28 px, `bg-[--elevated]`, caption-styled labels `text-secondary`, underline 1 px `border-subtle`.
- Body row 28 px, `mono-body`, no zebra. Row hover = `bg-[--elevated]`.
- Sort affordance: clickable headers; active sort shows chevron 12 px to the right of label, `text-primary`.
- State-badge column cells use a **3-char UPPERCASE chip** matching §8.
- Column widths fixed by skill manifest; overflow → truncate with ellipsis, full value in `title` tooltip.
- Footer row 24 px: count (`7 rows`) + CSV / JSON export buttons (ghost text, 12 px).

### 5.4 ResultCard — object variant

Key-Value grid. Key column is `caption`-style, right-aligned, 140 px. Value column is `mono-body`, wraps. Full-JSON view collapsed by default under a `view raw` disclosure (1 line, text-muted, right-aligned above the grid).

### 5.5 ResultCard — log variant

Container `bg-[--canvas]`, `font-mono text-[12px]`, line-height 1.55, left-padding 12. Selection color `--focus`/15%. ERROR / WARN keywords auto-highlight: red, yellow respectively.

### 5.6 ResultCard — chart variant

See §7.

### 5.7 PlanCard

Three regions stacked with 1 px dividers:
1. **Effect diff**: `before → after` on two mono rows, ~17 px tall each, with `→` glyph in `text-muted`.
2. **Rollback hint**: caption label + mono body; collapsible if > 2 lines.
3. **Policy footnote**: caption-styled line: `needs 1 approver · audit recorded on apply`.

### 5.8 ApprovalCard

- Contains one informational row: `approver: @human-…  pending  2 m ago`.
- Two buttons right-aligned: `Reject` (ghost) then `Approve` (filled `--write`).
- `Reject` click reveals an inline `reason` input (required before submitting).
- **Danger variant**: top stripe 4 px `--danger` + a locked section above the buttons: `Type YES to unlock Approve [___]`. Approve button uses `disabled:opacity-50` until the input value strictly equals `YES`; on unlock the button fills `--danger` instead of `--write`.

### 5.9 RunCard

32 px tall while streaming: one line `running …  ${elapsed}s  ↓ ${bytes}` in `text-secondary`, plus a 2 px progress bar in `--pending` sliding left-to-right over 1.2 s (paused on hover). On completion, collapses to 24 px single line `done in 842 ms · exit 0`.

### 5.10 ErrorCard

- Header: `text-danger caption` like `✕ ExecutionError · exit 1`.
- Body: `body` text, 2 sentences max — the **What / Why / How**.
- Footer: 1 disclosure `show raw stderr` (text-muted, 12 px).

### 5.11 LLM summary block (**ONLY card that uses `--llm`**)

- Rail `--llm`.
- Top row: `caption` badge `LLM·generated · gemini-2.5-flash` left-aligned; `hide` ghost button right-aligned.
- Body regions (each separated by `border-subtle`):
  1. **Summary** — `body` text.
  2. **Highlights** — up to 5 bullets, `small` text.
  3. **Findings** — rows: level-icon (info/warn/error) + text; icons use respective tokens.
  4. **Suggested commands** — each renders as a **read-only chip**, mono, 12 px, `--text-primary` on `--elevated`; click = "copy into CommandBar". Never auto-runs.
- **Divergence warning**: if present, a 28 px strip inserted at the very top with `bg-[--danger]/10 border-l-2 border-[--danger] text-[--danger]` and the warning text; blocks the rest until user ACKs (no modal — just a `got it` ghost button right-aligned).

## 6. Table styling

As per §5.3. Additional: empty state is a single row with centered `— no rows —` in `small text-muted`, row height same as data rows.

## 7. Chart style (one type — `chart.kind = line | bar`)

- **Geometry**: 220 px tall by default; 440 px on explicit `size: tall` in skill.
- **Axes**: 1 px `--border-subtle`; ticks only at rounded integers; tick labels `caption` `text-muted`.
- **Lines** (line chart): 1.5 px stroke, rounded caps, no fill, no gradient. Data colors draw from `[--ok, --pending, --write, --warn, --danger, --llm]` in that order; each distinct series gets a **unique shape marker** (circle/square/triangle/diamond) every N points so the chart is legible in grayscale too (accessibility rule: color-not-only).
- **Bars**: 1 px `--border` stroke around each bar, fill at 90 % of its color token.
- **Tooltip**: on hover/focus, a 1 px `--border` floating panel with exact value in `mono-body`. Keyboard-reachable via Tab.
- **Legend**: row above the chart, small caption, clickable to toggle series.
- **Companion table**: small button `show data` under the chart toggles a collapsed table of the same data.

## 8. Status chip vocabulary

All chips: 4 px radius, 1 px border, `caption` text, height 18 px, px 6 py 0.

| Chip | Background | Border | Text |
| --- | --- | --- | --- |
| `READ`                | `--ok`/10       | `--ok`/40       | `--ok` |
| `WRITE`               | `--write`/10    | `--write`/40    | `--write` |
| `DANGER`              | `--danger`/10   | `--danger`/60   | `--danger` |
| `AWAIT`               | `--pending`/10  | `--pending`/40  | `--pending` |
| `REJECTED`            | transparent     | `--border`      | `--text-muted` |
| `OK`                  | `--ok`/10       | `--ok`/40       | `--ok` |
| `FAIL`                | `--danger`/10   | `--danger`/40   | `--danger` |
| `WARN`                | `--warn`/10     | `--warn`/40     | `--warn` |
| `LLM`                 | `--llm`/10      | `--llm`/50      | `--llm` |

## 9. Motion

Five tokens only. All respect `prefers-reduced-motion: reduce` → instant fallback.

| Token | Duration | Curve | Where |
| --- | --- | --- | --- |
| `m-instant`  | 80 ms | `cubic-bezier(0.2, 0, 0.2, 1)` | Hover state, chip state transitions |
| `m-enter`    | 160 ms | `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quint) | Card mount, completion popover show |
| `m-exit`     | 100 ms | `cubic-bezier(0.5, 0, 0.9, 0.3)` (ease-in-quad) | Approval → RunCard swap |
| `m-stream`   | 1200 ms loop | `cubic-bezier(0.4, 0, 0.6, 1)` | RunCard progress sweep, streaming dot pulse |
| `m-error`    | 200 ms | `cubic-bezier(0.1, 0.6, 0.3, 1)` | Error wavy underline reveal, divergence strip slide-in |

Rules: only `transform` + `opacity` animated; never width/height. Exit < enter (rule from skill).

## 10. Layout

One window. Two viewport targets.

### 10.1 1920 × 1080 (desktop default)

```
┌────────────────────────────────────────────────────────────────┐
│ ContextBar — 48 px                                             │
├────────────────────────────────────────────────────────────────┤
│ Conversation — fills (overflow-y). Centered max-w 960 on       │
│ ≥ 1440 px, full-width below. Bottom padding 16 px.             │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│ CommandBar + StatusLine — 72 px + 28 px = 100 px               │
└────────────────────────────────────────────────────────────────┘
```

Conversation inner height at 1080p ≈ 932 px. A table ResultCard with 28 px header + 28 px rows + 24 px footer fits **≥ 30 rows** before scroll. Requirement is ≥ 20; met.

### 10.2 1366 × 768 (tight laptop)

Same three regions. Inner conversation height ≈ 620 px → **≥ 20 rows** for a full-width table card; requirement met.

### 10.3 < 1024 px (mobile tolerance)

Not a target. Render the layout but display a 1-line banner `Slash is designed for a desktop — some columns may be hidden.` Tables hide columns marked `priority: secondary` in the skill manifest (future work; not shipped in Demo).

## 11. Accessibility Budget

- Contrast AA for every text/background pair listed above (verified manually).
- Focus ring: `2 px --focus` with 2 px offset; visible on keyboard focus only.
- All semantic color carries a glyph or chip text. No color-only meaning.
- Tab order = visual order. Approval buttons focus in `Reject → Approve`.
- `prefers-reduced-motion: reduce` → all motion tokens collapse to 0 ms.

## 12. Tailwind mapping (what `tailwind.config.ts` must export)

- `colors.*` — mirror §2.1 and §2.2 tokens via `var(--…)` against `html.dark` class toggle.
- `fontFamily.sans / .mono` — already set (Geist).
- `borderRadius.sm / md / lg` — 4 / 6 / 10.
- `boxShadow` — **none added**. No decorative shadows in this system.
- `transitionTimingFunction` — register the 5 motion curves.
- `keyframes.stream-sweep` — for the RunCard bar.

## 13. Anti-patterns (from skill check)

- No light-mode-default
- No cursor-pointer missing on buttons
- No hover without transition
- No emojis as icons
- No contrast < 4.5:1 body text
- No focus rings removed
- No `prefers-reduced-motion` ignored
- No gradient metrics / "hero" centered numbers
- No glassmorphism / blur
- No shadow beyond 0
