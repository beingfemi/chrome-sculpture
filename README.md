# Chrome Sculpture

Four procedural chrome sculptures rendered in real time with three.js. Nothing here
is modelled or photographed — the geometry, the material and the studio it reflects
are all generated in the browser at load.

**Live:** <https://chrome-sculpture.vercel.app>

## The pieces

| | Form | How it's made |
|---|---|---|
| A01 | **Knot** | A (2,3) torus knot swept with a cross-section that breathes along its length |
| B02 | **Column** | A rounded-square superellipse swept up a waisted profile through 3/4 of a turn |
| C03 | **Mass** | An icosphere displaced by two layers of value noise — broad lobes, fine incident |
| D04 | **Band** | A Möbius strip with real thickness; the grid meets itself rotated half a ring |

## How the chrome works

A mirror has no colour of its own, so the material is only as good as the room it
reflects. `src/env.js` paints a fake photographic studio — bright ceiling, dark floor,
a hard horizon, three strip lights and a scatter of bounce cards — onto a 2048×1024
equirectangular canvas with a seeded PRNG, then runs it through `PMREMGenerator`.
The material itself is a plain `MeshStandardMaterial` at `metalness: 1`,
`roughness: 0.035`, `envMapIntensity: 1.25`.

`src/material.js` injects a ripple into the stock physical shader via
`onBeforeCompile`: a gaussian ring expands from the point of impact, displacing
vertices along their normals and — more importantly — bending those normals by the
slope of the wave. On a mirror the displacement is nearly invisible; the normal bend
is what you actually see.

## Controls

- **Click the sculpture** — sends a ripple out from the point you hit
- **Click beside it** — flicks it through a full revolution
- **1–4 / ← →** — switch form
- **R** — ripple from the centre
- **Move the pointer** — the sculpture follows you (desktop)

## Running it

No build step. Any static server:

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

three.js is pulled from jsdelivr via an import map, so there are no dependencies to
install and nothing to bundle.

## Credit

The brief was the chrome centrepiece on [fayemi.design](https://fayemi.design) —
its material language, pointer easing, idle float, click-ripple and full-turn spin.
Every asset and every line of code here is original; no geometry, texture or source
was taken from that site.
