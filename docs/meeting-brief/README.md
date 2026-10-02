# Fanela Central System -- Meeting Brief (LaTeX)

Plain-English + detailed briefing document for a project meeting.

## Build

```sh
cd docs/meeting-brief
./build.sh        # runs pdflatex twice -> main.pdf
```

Requirements: TeX Live (pdflatex), packages `tcolorbox`, `enumitem`, `mdframed`
(installed to the user tree via `tlmgr --usermode install tcolorbox enumitem mdframed`),
plus standard packages (`tikz`, `booktabs`, `tabularx`, `xcolor`, `hyperref`,
`geometry`, `lmodern`, `caption`).

Manual build:

```sh
pdflatex -interaction=nonstopmode main.tex
pdflatex -interaction=nonstopmode main.tex   # second pass for TOC/refs
```

## Contents

| File | Section |
|---|---|
| `sections/01-summary.tex` | Executive summary + decisions table |
| `sections/02-current.tex` | What v11 is, strengths, limitations |
| `sections/03-keeps.tex` | All business rules preserved from v11 |
| `sections/04-changes.tex` | Technical changes table |
| `sections/05-architecture.tex` | Deployment diagram, modules, stack rationale |
| `sections/06-permissions.tex` | Roles + permission matrix |
| `sections/07-integrity.tex` | Data integrity, auth, backups |
| `sections/08-migration.tex` | Migration steps, UAT, anti-patterns |
| `sections/09-phases.tex` | Phase 0-4 delivery table |
| `sections/10-decisions.tex` | Decisions taken + open questions for the meeting |

Source of content: `docs/superpowers/specs/2026-09-27-fanela-central-system-design.md`.
