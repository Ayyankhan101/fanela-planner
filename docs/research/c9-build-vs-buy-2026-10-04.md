# C9 — Pre-P5 build-vs-buy review

Date: 2026-10-04 · Trigger source: `TODOS.md` C9 record (2026-10-03) · Phase gate: before P5 integrations

## Trigger under test

> Revisit build-vs-buy if a **commercial print MIS covers ≥80% of the 77 register
> rules at ≤ £200/month**.

Both prongs must hold for **the same product**. Sources below are vendor/list
pricing checked 2026-10-04 unless noted.

## Method

1. Price screen: UK-relevant print MIS + the two box-ERP alternatives already
   in spec §20 (PrintVis, Odoo).
2. Coverage screen only for candidates that **pass price** — mapping their
   out-of-box functionality against the 11 rule-ID domains of
   `docs/phase0/01-rule-register.md` (77 rules: A5, B6, C4, D10, E7, G8, J9,
   L5, M4, P9, S10). Two bands: **strict** (feature demonstrably exists
   out-of-box) and **generous** (workflow intent plausibly met by configuration).
3. Kill only if one product passes both prongs.

## 1. Price screen

| Candidate | Published price (2026-10-04) | ≤ £200/mo? | Source |
|---|---|---|---|
| **PrintDesk (UK)** | £39.99 + VAT/mo flat, unlimited users | ✅ PASS | printdesk.co.uk |
| **Pro-cess (UK)** | from £30/mo | ✅ PASS | pro-cess.co.uk |
| **Odoo Standard** | UK list ≈ £18/user/mo promo, £23 renewal; Community free (self-host) | ✅ PASS (8 seats ≈ £144–184/mo) | odoo.com/pricing + erpresearch.com 2026 breakdown |
| **PrintSmith Vision** | $599–750/**year** (reseller, all-shop licence) ≈ $50–62/mo | ✅ PASS | cprint.com/vision (Crouser, official reseller) |
| Tharstern Desktop | No public price; 5-licence minimum, quoted after sales call; directory £5.18/user unverified | ⚠️ UNVERIFIABLE | twistsoftware.com comparison, GetApp/Capterra listings |
| PrintVis (D365 BC) | $130–150/**user**/mo full users + BC Essentials; implementation $36–100k | ❌ FAIL | printvis.com/solution, sabrelimited.com pricing guide |
| Ordant | $295/mo minimum (5 users) | ❌ FAIL | ordant.com/pricing |
| Infigo | from $1,000/mo (web-to-print, not full MIS) | ❌ FAIL | infigo.net/platform, Capterra |
| Twist Print | $299–1,500/mo | ❌ FAIL | twistsoftware.com published plans |
| Panacea | £8,570/licence/year | ❌ FAIL | applytosupply G-Cloud listing |

## 2. Coverage screen (price-pass candidates only)

Rule domains tested (rule-ID letters, not spec-section letters):
**A** artwork approval machine (5) · **B** auth/sessions/no-hard-delete (6) ·
**C** customer master + order snapshots (4) · **D** stage machine + dept
scoping + dispatch guard (10) · **E** typed import + role-scoped export (7) ·
**G** readiness traffic-light matrix (8) · **J** job structure/product
grid/search (9) · **L** append-only stock ledger + audit scoping (5) ·
**M** server-side cost gates (4) · **P** dispatch plan/shipments/finalise/void
(9) · **S** swatch machine + Embroidery gate (10).

### PrintDesk / Pro-cess class (small UK print MIS)

Covers: quotes→orders, customers, delivery, stage **board** (drag between
print/laminate/cut/delivery), artwork e-sign sign-off, Xero invoicing.
Lacks: typed legacy-import confirm (E), readiness gates (G), swatch (S),
versioned artwork approval machine (A — e-sign ≠ version machine), stage
transition guards/dept scoping (D), append-only corrections ledger (L),
server-side export cost-stripping (M), product size grid (J).

- Strict: **~19/77 ≈ 25%** · Generous: **~30/77 ≈ 39%**

### Odoo (Standard, all apps)

Covers: customers/products, stock moves, projects/tasks as stages, delivery,
audit chatter, import wizard, record rules (partial role gating), invoicing.
Lacks: swatch (S), readiness computation (G), Fanela stage/finalise guards
(D/P), typed-count import gate + reconciliation + export column stripping
(E/M), append-only correction semantics (L), artwork version machine (A).

- Strict: **~29/77 ≈ 38%** · Generous (config only, no custom modules): **~35/77 ≈ 45%**
- Note: custom Odoo modules to close gaps = **paid customisation**, the exact
  cost spec §20 already flagged — outside the trigger's plain meaning
  ("covers").

### Structural ceiling argument

Domains **S (10) + G (8)** are Fanela-specific (embroidery swatch gate,
computed readiness matrix). No candidate in this review demonstrates either
out-of-box; even granting every other domain generously (59/77), ceiling =
**~77% < 80%** before touching S/G. The trigger cannot be met by this class
of product without customisation.

### Price-fail candidates

Not coverage-tested (price prong already failed): PrintVis, Ordant, Infigo,
Twist, Panacea. Tharstern unverifiable → cannot be counted as passing either
prong on evidence; noted as "re-check if public pricing appears".

## 3. Verdict

**NO KILL — trigger not met.** No single commercial product passes both
prongs:

- Price-pass group tops out at ~39–45% generous coverage (≤45% vs 80% needed).
- Coverage-plausible enterprise MIS (PrintVis class) fails price by 2–7×
  before per-seat scaling.
- Tharstern unverifiable.

**P5 integrations unblocked** (this checkpoint was the recorded pre-P5 gate).
Spec §20 rejection of PrintVis/Odoo stands, now with coverage evidence instead
of assertion.

## Revisit triggers (unchanged + one added)

1. Any product publishes ≤£200/mo **and** plausibly claims ≥80% register coverage.
2. Client decides full-ERP scope (purchasing/payroll/accounting) is wanted — different project.
3. **Added:** re-run coverage screen if Fanela's own swatch/readiness rules get
   re-scoped out (dropping S+G raises every candidate's ceiling by 23 points).

## Sources

- printvis.com/solution · sabrelimited.com/printvis-license-pricing · itechguides.com/products/printvis
- ordant.com/pricing · toolradar.com/tools/ordant/pricing
- infigo.net/platform · capterra.ca/software/158603/infigo
- twistsoftware.com/en/compare/twist-print-vs-tharstern
- getapp.co.uk/software/2045883/tharstern · capterra.com.au/software/143758/tharstern
- printdesk.co.uk · pro-cess.co.uk/for/print-shops · pathwaymis.co.uk/features
- cprint.com/vision · a2is.com catalog (PrintSmith) · printplanet.com thread (historical EFI pricing)
- odoo.com/pricing · erpresearch.com/pricing/odoo · mediodconsulting.com/odoo-price-increase-2026
- applytosupply.digitalmarketplace (Panacea G-Cloud)
