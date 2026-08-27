# PostcodeHub.uk

A non-commercial, non-partisan community information hub for UK neighbourhoods, structured
City → Council Borough → Outward Postcode (outcode). See
[community-locality-network-web.md](./community-locality-network-web.md) for the full concept.

This repo is the proof of concept: **London → Richmond upon Thames**, covering all 16 outcodes
that touch the borough (TW1–TW13, SW13–SW15, KT1/KT2/KT8), each with up to 10 category pages.

## How it works

1. `npm run ingest` runs `scripts/ingest/run-all.ts`, which pulls real data from open UK sources
   into `data/raw/` and `data/processed/` (see table below).
2. `astro build` reads `data/processed/` at build time via `src/lib/data.ts` and statically
   generates every page with `getStaticPaths()`. **No API calls happen during the Astro build
   itself** — that's the ingest step's job, kept separate so builds stay fast and don't hit
   rate limits.
3. A category sub-page (e.g. `/london/richmond-upon-thames/tw9/places/`) is only generated if
   that outcode actually has data for it — see `hasContent()` in `src/lib/data.ts`. This avoids
   the thin-content problem the spec doc calls out.
4. Two categories — transport (TfL) and weather — are deliberately **not** pre-built. They're
   fetched client-side in the browser (`src/components/LiveTflWidget.astro` and
   `LiveWeatherWidget.astro`) so the static pages never go stale.

Run `npm run dev` for local development (data must already exist in `data/processed/` — run
`npm run ingest` at least once first).

## Data sources — what's real, what's curated, what's linked-out

| Category | Source | How current is it |
|---|---|---|
| Geography / hierarchy | [postcodes.io](https://postcodes.io) | Live at ingest time |
| Health (GP/dentist/pharmacy) | NHS Organisation Data Service | Live at ingest time |
| Schools + Ofsted | DfE GIAS + Ofsted inspections CSV | Live at ingest time (daily/quarterly datasets) |
| Safety | data.police.uk | Live at ingest time, trailing 12 months |
| Property | HM Land Registry Price Paid Data | Live at ingest time, current + prior year |
| Representatives (MP) | UK Parliament Members API | Live at ingest time |
| Representatives (councillors) | Scraped from Richmond council's ModernGov site | Live at ingest time, but council-specific — no national API exists |
| Planning | *No public API found* for Richmond's planning portal (a proprietary JS SPA) | We link out to the live register instead of fabricating listings |
| Places | Hand-curated JSON (`seed-places-events-history.ts`) | Static — only well-established, verifiable local landmarks |
| Events | *No API* — dated events go stale immediately if faked | We link out to a live local events listing |
| History | Hand-curated JSON | Static — factual, borough- and outcode-level summaries |

Re-run `npm run ingest` (or an individual `npm run ingest:<step>`, see `package.json`) to refresh
everything except the hand-curated places/events/history seed.

## Deployment

Configured for Cloudflare Pages via `wrangler.toml` (`pages_build_output_dir = "dist"`). Build
command: `npm run build` (runs ingest, then `astro build`). Point Cloudflare Pages at this repo
with that build command and `dist` as the output directory — no adapter needed since this is a
fully static site.

## Known follow-ups

- **TfL app key**: the transport widget calls the TfL API unauthenticated, which works but is
  rate-limited. Register a free key at [api-portal.tfl.gov.uk](https://api-portal.tfl.gov.uk/)
  for production use.
- **Planning**: if a real API/RSS is ever found for Richmond's planning portal, replace
  `scripts/ingest/fetch-planning.ts`'s link-out with real ingestion.
- **Councillor scrape**: `fetch-representatives.ts` parses Richmond's ModernGov HTML, which is
  council-specific and could break if the council changes its site.
