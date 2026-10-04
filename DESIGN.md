# Fanela Production Planner — DESIGN.md

Source of truth for visual and interaction conventions. Derived from shipped
code (Tailwind v4 + `app/globals.css`), not aspirational. New UI follows this;
changes here first.

## Stack

- Tailwind CSS v4 (`@import "tailwindcss"` + `@theme inline`), no component library.
- Fonts: Geist Sans / Geist Mono via `next/font/google`, exposed as
  `--font-geist-sans` / `--font-geist-mono`.
- Dark mode: `prefers-color-scheme: dark` media query (system-driven, no manual
  toggle). Component-level `dark:` variants mirror light classes.

## Typography

| Token | Usage |
|---|---|
| `font-sans` (Geist) | default body, all UI |
| `font-mono` (Geist Mono) | IDs, job numbers, counts, timestamps, fixture file names |
| `text-sm` | dominant body/control size (~110 uses) |
| `text-xs` | table cells, meta labels, chips |
| `text-lg`/`text-xl` | section headings only (page title = `text-2xl`) |
| `font-semibold` | headings, buttons, key numbers |

## Color

Neutral-first zinc scale; color carries meaning only.

| Role | Light | Dark |
|---|---|---|
| Page shell | `bg-zinc-50` | `bg-black` |
| Card/panel | `bg-white` + `border-zinc-200` | `bg-zinc-950` + `border-zinc-800` |
| Primary text | `text-zinc-900` | `text-zinc-50` |
| Secondary text | `text-zinc-500` | `text-zinc-400` |
| Primary button | `bg-zinc-900 text-zinc-50` | `bg-zinc-100 text-zinc-900` (inverted) |
| Secondary button | `border-zinc-300 hover:bg-zinc-100` | `border-zinc-700 hover:bg-zinc-900` |
| Destructive / error | `text-red-600` (banners: `bg-red-50 border-red-200 text-red-800`) | `text-red-400`, `bg-red-950` |
| Warning | `text-amber-600` | `text-amber-400` |
| Links | `text-blue-600` | `text-blue-400` |
| Success | no green — success is neutral state + summary counts |

## Shape & spacing

- Radius: `rounded-md` for buttons/inputs/chips (dominant), `rounded-lg` for
  cards/panels, `rounded-full` for status dots only.
- Layout: top nav bar, `<main>` = `mx-auto max-w-6xl px-4 sm:px-6 py-6`.
- Vertical rhythm: `space-y-4` / `space-y-6` between sections; `gap-2`/`gap-3`
  inside toolbars; card padding `p-4`/`p-6`.
- Dense data (tables, chips) beats whitespace — this is an ops tool.

## Components

- **Tables**: bordered card, `text-xs` cells, mono for machine values,
  header row `text-zinc-500 font-semibold`.
- **Steppers** (import wizard): numbered chips, active = `border-zinc-900
  font-semibold`, done = enabled, future = `text-zinc-400`.
- **Count chips**: bordered pill, `0 skip` neutral, `N error` red, `N warn` amber.
- **Banners**: full-width, bordered, red for blocking errors, placed above
  the form they describe.
- **Empty states**: one sentence + the action that fills it
  ("No imports yet. Upload a legacy JSON export to start.").
- **Destructive actions**: red text button (`Discard import`), never the
  primary button position; confirmation inline, no modal.

## Interaction rules

- Destructive/irreversible actions require an inline confirm or typed gate
  (import confirm gate: type row count when ≥50 creates or any warning).
- Long operations: disable button + status text ("Uploading and validating…"),
  never a spinner without words.
- Every multi-step flow shows a Result/summary state with counts
  (imported/skipped/errors/warnings) and a path back to start.
- Errors render as banner with the server message verbatim; user can retry
  from the same step.

## Accessibility

- Semantic tables with `<th>`; buttons are `<button>`; file input wrapped in
  a visible `LabelText` with click-to-choose affordance.
- Visible focus rings (`focus-visible`) on interactive elements; min `py-1.5`
  hit targets.
- Color never the sole signal: severity shown as word + dot (`• create`,
  `• error`), not color alone.
- `aria-live` on wizard status line for async state changes.

## Reference captures

Real UI states live in `designs/import-wizard-20261001/`
(upload-empty, preview-all-rows, confirm-gate, import-complete, upload-error).

## Non-goals

- No brand accent color, illustrations, or marketing typography — internal ops tool.
- No client-side theme toggle (system preference is the contract).
- No animation beyond default Tailwind transitions on hover/focus.
