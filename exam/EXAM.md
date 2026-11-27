# Frozen Judging Exam: SVG to 3D Volume Tool

Frozen: 2026-11-26, before any tool code was written. This exam does not
change to make a failing version pass. If a case is genuinely impossible,
that is recorded as a stated limit in the README, not edited away here.

Baseline: three one-off proof pages (shield, castle gate, textured chest)
in ~/workspace/x-bookmarks-2026-11-26/category-e-tests/test4*. All three
hand-built THREE.Shape objects in code. None of them parsed a real SVG
file. The production tool must parse real SVG input.

## Layer convention the exam SVGs use

Exam SVGs carry optional attributes the tool must honour:
- data-depth="N" extrusion depth in SVG units for that element
- data-material="name" one of: steel, gold, wood, stone, iron, copper, gem, flat color via fill
- data-role="base|raised|recessed|hole-layer" placement hint
- fill color is the fallback material color
- Subpaths inside one path with fill-rule="evenodd" are holes
- Stroke-only elements (E7) must be given volume, not dropped

## Cases

### E1 Simple emblem (easy)
File: e1-shield.svg. Shield outline plus cross emblem, two fills.
Origin: baseline Test 4 design, now as a real SVG file.

### E2 Multi-path layered design with holes (medium)
File: e2-castle-gate.svg. Tower outline, door and window holes as
evenodd subpaths, portcullis bars as a recessed layer, raised star.
Origin: baseline Test 4b design, now as a real SVG file.

### E3 Real holes (medium)
File: e3-ring-keyhole.svg. A ring (donut) and a lock plate with a
keyhole (circle plus slot subpaths, evenodd). Holes must be
see-through: backdrop colour visible through them in the render.

### E4 Text and lettering (medium-hard)
File: e4-lettering.svg. Letters R and A drawn as paths. R has a bowl
counter hole, A has a triangular counter hole. Letters must read as
letters at front view.

### E5 Curved profile (medium)
File: e5-wave-banner.svg. A banner shape built from arc (A) and cubic
(C) commands only, with a wavy bottom edge and a curled end. Curves
must stay smooth, no faceted or collapsed arcs.

### E6 Detailed creature silhouette (hard)
File: e6-dragon.svg. A dragon silhouette with wings, horns, tail curl,
and concave notches, drawn with many cubic segments. Silhouette must
match the flat original at front view and stay clean at angles.

### E7 Thin fragile strokes (hard)
File: e7-snowflake.svg. A snowflake drawn only with stroke lines
(stroke-width 5, no fills). The tool must give strokes volume. All six
arms must survive.

### E8 Adversarial mix (hard)
File: e8-adversarial.svg. Contains all of: three overlapping circles,
one open path (no Z), one tiny 4-unit star detail, and a grid of 24
small dot paths. The tool must not crash, must warn about the open
path, must auto-close it, and must keep the tiny star and all dots.

## Gates per case (all must pass)

- G1 Recognisable: front render matches the flat SVG design at a glance.
- G2 Real depth: angled renders show side walls and the specified depth
  differences between layers.
- G3 Holes: where holes are specified (E2, E3, E4), the backdrop colour
  shows through them in the front render. Checked by viewing, and by
  sampling the hole-centre pixel in the capture harness where the
  harness knows the hole position.
- G4 Texture: where a textured material is assigned (E2 stone, E3 iron,
  E5 wood), the texture reads as that material, not flat colour.
- G5 No broken geometry: no page console errors, at least one mesh per
  layer, finite bounding box, no NaN vertices reported by the harness.
- G6 Clean silhouette at 3 angles: left, front, and right renders all
  viewed; no self-intersection artefacts, no missing parts.

## Production gates (whole tool)

- P1 One reusable tool in ~/workspace/svg-to-3d-tool/. Input: an SVG
  file or pasted SVG markup or pasted path data, plus options for
  depth, bevel, texture set, and materials.
- P2 Interactive 3D view with orbit controls.
- P3 PNG render export from the tool itself.
- P4 GLB export that parses back: valid GLB header, at least one mesh
  per layer, materials present.
- P5 Procedural texture library in code: wood, metal, stone minimum.
  No AI image generation, no external image files.
- P6 README with exact usage, options, honest limits, exam results.
- P7 All 8 exam cases pass G1 to G6 in the same version, renders viewed.

## Scoring record

Each version gets a row in LEDGER.md in this folder: version, the one
lever changed, per-case pass/fail, keep or reject decision, and why.
