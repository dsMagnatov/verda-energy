# VERDA ENERGY

A responsive cinematic 3D website about solar energy, built with Three.js and Vite. Floating scanned rocks frame the opening typography; a reversible scroll journey reveals a planted courtyard, reflective pond and descending solar panel.

[Live website](https://verda-energy.vercel.app/) · [Source repository](https://github.com/dsMagnatov/verda-energy)

Pushes to the main branch deploy automatically to the Vercel project `verda-energy` in the `stanislav-magnatov` account.

## Development

Use Node.js 22.12+ and pnpm 11.25.0.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
pnpm build
pnpm preview
```

The preload screen waits for fonts, scanned models, textures and shader preparation for both scenes. Desktop and mobile layouts use Instrument Serif and Manrope. Scene controls are preserved in the source and hidden until requested again.

## Vercel

Import this repository into Vercel using the Vite framework. The build output is dist/client; the root api/ directory provides Node.js functions.

- GET /api/scene-settings serves the exported, validated shared scene preset in src/published-scene-settings.json, retaining the published appearance for every visitor.
- The editor remains hidden and writes are disabled on this public deployment. Update the preset JSON and redeploy to change the published look. Restoring browser editing requires an authenticated owner interface; unverified Sites gateway headers are never trusted on Vercel.
- /api/contact retains validated same-origin form submissions. Connect a private Vercel Blob store for durable inquiries. The SDK uses the project store ID and Vercel OIDC automatically; no credentials belong in the repository or client bundle. Inquiries can be viewed in the owner's Vercel storage dashboard. Public inbox access is disabled.
- The earlier Sites deployment and its private storage remain independent. Private inquiry history and deployment credentials are excluded from this repository.

## Checks

```sh
node scripts/check-preloader.mjs
node scripts/check-scene.mjs
node scripts/check-responsive.mjs
node scripts/check-shared-settings.mjs
node scripts/check-contact-api.mjs
node scripts/check-vercel.mjs
```

## Source and materials

Selected source helpers from [Verdant Meadow](https://github.com/dsMagnatov/verdant-meadow) are retained under src/verdant/ for provenance. Otherlife and Symphony of Vines informed the visual references; their proprietary production code and assets are not included.

Poly Haven's Dark Rock, Rock Moss Set 01 and Fern 02 scans are CC0. Attribution, checksums and source links are in docs/. Self-hosted fonts include their SIL OFL licenses in public/assets/fonts/.
