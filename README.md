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
| C03 | **Mass** | A sphere displaced by two layers of value noise — broad lobes, fine incident |
| D04 | **Band** | A Möbius strip with real thickness, standing up so the half-twist reads |

## How the morph works

All four are evaluated over the same 448×80 grid and share one index buffer, so
there is only ever one mesh on screen. Switching form is a lerp from one position
array into another — nothing is swapped, nothing is cut, so nothing has to be
hidden, and the morph carries no ripple at all. The change of shape is the whole
event; it just gets a slow turn and the faintest dip so it reads as a movement
rather than a substitution.

The grid is stitched as an open tube. Forms that close on themselves put their
last row exactly on top of their first — the knot at the same offset, the Möbius
rotated by half a ring — so the surface closes without any wrap-around quads and
the index buffer stays identical for every form. Those coincident rows, and the
collapsed poles of the column and the mass, are separate vertices that
`computeVertexNormals` would leave a crease across; `healSeams` averages each
coincident group, which on a mirror is the difference between a sculpture and a
seam. Normals are lerped alongside positions rather than recomputed each frame —
a whole blend costs well under a millisecond — and the exact normals are put back
when the morph settles.

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

## Type and the loader

The typography follows [unstated.co](https://www.unstated.co), measured off their
site rather than eyeballed. Their whole interface runs on a single value — header,
links, index numbers and loader are all **12px / 400 weight / 13.2px line box /
-0.12px tracking**. The 1.1 line height is the signature: paragraphs stack tightly
enough to read as a block rather than a list of lines. No caps, no monospace — the
voice is a caption in a catalogue rather than a label on a machine.

The face is Antique Legacy Book (Optimo), the same one they use, resolved from
the local system by family name — the way `font-family: "Helvetica Neue"` always
has been. The trial is **not** embedded, committed or served from this repo:
anyone with it installed sees it, anyone without falls through to the web stack.
That keeps a trial licence out of a public repo and off a public deploy. Verified
against their live site, the trial is the same font to the decimal — lowercase
alphabet 1363.2, x-height 51.5, cap height 70.0, identical on both.

The web fallback is Schibsted Grotesk, picked by measurement rather than by eye —
canvas metrics for a dozen free grotesques compared against the real thing at
100px:

| | sample string | lowercase set | x-height | cap height |
|---|---|---|---|---|
| Antique Legacy Book | 2942.1 | 1363.2 | 51.5 | 70.0 |
| **Schibsted Grotesk** | +0.9% | **+0.1%** | +2.3% | +0.4% |
| Public Sans | +1.1% | +0.6% | +0.4% | +3.3% |
| Inter | +3.0% | +2.1% | +6.0% | +4.0% |

Inter — the first choice here — is in the right category but 3% wide with a 6%
taller x-height, which is enough to read as a different texture and to break
lines in different places. Schibsted wraps where Antique wraps, so a visitor
without the licensed face gets the same composition in a near-identical fit.

The loader block is theirs too: centred, `width: 100%` up to a 60rem cap, with
16px of side padding. The `width: 100%` is load-bearing — grid centring would
otherwise shrink-wrap the block to its longest line, so the text would break at
its natural width instead of the container's.

The loader matches theirs, including its timing. A beat of empty ground for one
second, then every word fades up over a slow **two** seconds, each starting 80ms
after the last, and a 500ms hold once the sentence is whole — about 5.4s end to
end, skippable with a click anywhere.

The long fade against the short stagger is the whole effect, and it is easy to
get wrong. Because each word takes 2s to arrive but they start only 80ms apart,
every word is in flight at once: the sentence surfaces as a body, leaning left,
with the tail trailing off in progressively lighter grey. A short fade with the
same stagger gives you a light travelling word by word instead — a much busier,
cheaper-looking thing, and not what they built.

It runs on CSS transitions and timers rather than the render loop —
`requestAnimationFrame` is paused in a background tab, and tying the reveal to it
would leave a page opened in the background stuck behind the loader until someone
focused it. The sculpture's own intro starts as the sheet clears, so the two read
as one movement.

The palette is not theirs: this keeps its own light and dark modes.

## Controls

- **Click the sculpture** — sends a ripple out from the point you hit
- **Click beside it** — flicks it through a full revolution
- **1–4 / ← →** — morph to another form
- **R** — ripple from the centre
- **Move the pointer** — the sculpture turns to face the cursor, about 70° of yaw across the window (desktop)

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
The type treatment and the word-by-word loader follow [unstated.co](https://www.unstated.co).
Every asset and every line of code here is original; no geometry, texture, stylesheet
or source was taken from either site.
