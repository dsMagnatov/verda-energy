# CC0 nature assets for the desktop hero

Downloaded from official Poly Haven API manifests on 2026-10-19. All eleven original model, binary and texture files have MD5 and byte counts verified against that metadata. The total is **6,883,904 bytes (6.57 MiB)**.

Poly Haven licenses its assets under **CC0-1.0** and allows commercial use and redistribution. Attribution is optional; these credits are retained for provenance. See [Poly Haven license](https://polyhaven.com/license) and the [CC0 deed](https://creativecommons.org/publicdomain/zero/1.0/).

| Asset | Artists | Local glTF |
| --- | --- | --- |
| [Rock Moss Set 01](https://polyhaven.com/a/rock_moss_set_01) | Kless Gyzen | `public/assets/nature/rock_moss_set_01/rock_moss_set_01_2k.gltf` |
| [Fern 02](https://polyhaven.com/a/fern_02) | Rob Tuytel (scanning), Rico Cilliers (modeling) | `public/assets/nature/fern_02/fern_02_2k.gltf` |

The original file inventory, source URLs, byte counts and MD5s are recorded in `nature-downloads.json`. Binary-verified local geometry bounds, source node translations, vertex counts and suggested meshes are in `nature-assets.json`.

## Loading

Use ordinary Three.js `GLTFLoader`. No Draco, Basis/KTX2 decoder, or custom extension is required. Local `.bin` files and `textures/` directories retain the exact relative paths referenced by each glTF. The loader assigns sRGB base colors, linear normal/roughness maps, double-sided material settings and glTF UV orientation.

For a floating boulder, clone the selected mesh geometry and call `geometry.center()`, ignoring the original node translation. For a plant, clone geometry, center X/Z and move its minimum Y to zero. The rock collection includes six different shapes; `rock_moss_set_01_rock04` is the tallest, substantial boulder. All four fern meshes are useful: `fern_02_b`, `fern_02_c`, `fern_02_a`, `fern_02_d`.

## Fern transparency correction

The official fern glTF declares `alphaMode: MASK` and `alphaCutoff: 0.5`, but its referenced diffuse file is a JPEG with no alpha channel. The separate official `textures/fern_02_alpha_2k.png` is included in addition to the glTF dependency inventory. Load it with `TextureLoader`, set `flipY = false`, assign it to the fern material's `alphaMap`, retain `alphaTest = 0.5`, and set `needsUpdate = true`. Do not use the diffuse image as an alpha map; this asset includes the dedicated leaf mask.

## Reproduce

Run `scripts/download-nature.ps1` to download and checksum the exact original assets. Run `node scripts/inspect-nature.mjs` to check binary position bounds and dependency paths, then recreate the geometry summary.

Official metadata endpoints:

- https://api.polyhaven.com/info/rock_moss_set_01
- https://api.polyhaven.com/files/rock_moss_set_01
- https://api.polyhaven.com/info/fern_02
- https://api.polyhaven.com/files/fern_02
