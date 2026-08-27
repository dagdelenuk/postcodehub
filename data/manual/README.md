# Manual content overrides

Everything in `data/processed/` is regenerated on every `npm run build` — hand
edits there get overwritten. This folder is the opposite: it's **never**
touched by the ingestion scripts, so anything you put here survives every
rebuild and every deploy.

## banner-overrides.json

City/borough rotating banner images. Keyed by slug (the same slug used in the
URL — `london`, `richmond-upon-thames`, `kensington-and-chelsea`, etc). If a
slug has a non-empty array here, it **replaces** whatever
`fetch-banner-images.ts` found automatically for that location.

```json
{
  "kensington-and-chelsea": [
    {
      "src": "https://example.com/your-photo.jpg",
      "width": 1600,
      "height": 900,
      "credit": "Photographer Name · License · Source",
      "creditUrl": "https://example.com/photo-page",
      "license": "CC BY 4.0"
    }
  ]
}
```

Fields:
- `src` — direct image URL (must be publicly reachable at build time and at
  runtime — this is hotlinked, not downloaded).
- `width` / `height` — the image's real pixel dimensions (used for layout,
  doesn't need to be exact but should be roughly right).
- `credit` — short attribution text shown in the corner of the banner.
- `creditUrl` — where the credit text links to.
- `license` — shown as part of the credit; use "All rights reserved (used
  with permission)" or similar if it isn't an open license.

Only use images you actually have the right to use — this same rule applied
to the automated Wikimedia sourcing (verified free licenses only), and
applies here too.
