# Prompts

Two kinds of prompts live here: the prompts that built this tool (so the
work can be continued or recreated), and ready-to-paste prompts for
authoring SVGs the tool turns into 3D.

## Prompts that built the tool

### 1. The original build brief

> Run the full autonomous competition-tools iteration process on an SVG
> path to 3D volume tool until it is genuinely production ready.
> Primary use: a TTRPG token and prop library, plus general 2D-to-3D
> objects for games and scenes. Iterate, critique, fix, extend rounds,
> restructure, or trash and restart on your own calls. No round cap.
> Approval is required only for publishing or releasing the exact final
> version.

### 2. The process rules that went with it

> Freeze a judging exam BEFORE improving anything, with pass gates per
> case. One lever per version; a version is kept or rejected on exam
> evidence only. View every render as an image before calling it
> checked. Run cold critique passes over the results (keep / modify /
> kill). Never present an unverified claim as fact.

The frozen exam is in `exam/` (cases, gates, hashes, and the version
ledger that records every round, including the failures).

### 3. The stress-round prompt

> Those are not complex. Try more detailed things.

This produced the six stress designs in `stress/` (gears, mandala,
knight, ornate key, tree, ship) and exposed the buried-detail defect
fixed in v5 and v6.

### 4. The creation-expansion prompt

> Not everything is about extrusion alone. We want this to be a 3D
> creation tool, not just an extrusion tool.

This produced the `data-mode` build modes (revolve, sphere, tube) in v7
and v8, and the scene builder in the app.

### 5. The two fix briefs (for the record)

- Recessed detail lines were centred inside the whole model's depth
  and ended up buried inside the part they decorated. Brief: give
  recessed STROKE elements their own placement on the front surface of
  the solid containing their centre, like engraving; leave recessed
  FILLS centred (that is how layers inside holes work).
- The first placement still hid the lines because an extruded part's
  real front face sits at depth plus bevel thickness. Brief: measure
  the actual geometry bounds, then place against the measured face.

## Prompts for authoring SVGs for this tool

Paste one of these to an AI assistant (or use them as a checklist
yourself) to get an SVG designed for the converter.

### Token or emblem

> Draw a single SVG, viewBox 0 0 240 240, for a game token of
> [SUBJECT]. Use flat filled paths only. Control the 3D result with
> attributes: data-depth for layer thickness (base 20, raised detail
> 30 to 40), data-material from steel, gold, copper, iron, gem, wood,
> stone, metal, and data-role="recessed" for detail lines that should
> read as engraving on a part. Draw holes as subpaths inside the same
> path as their solid and set fill-rule="evenodd". No gradients, no
> text elements; lettering must be paths.

### Revolved prop (vase, pawn, bottle)

> Draw a single SVG, viewBox 0 0 120 240, containing ONE filled path
> that is the half profile of a [VASE / PAWN / BOTTLE]: the left edge
> of the path is a straight vertical axis line, and the outline runs
> up the outside of the object, over the top, and back down the axis.
> Put data-mode="revolve" and a data-material on the path.

### Scene piece with round parts and ropes

> Draw a single SVG, viewBox 0 0 260 220, of [SUBJECT]. Use
> data-mode="sphere" on circles or ellipses that should become balls
> or orbs (data-depth sets their thickness), and data-mode="tube" on
> stroked paths that should become round ropes, vines, or handles
> (stroke-width sets the tube thickness). Everything else extrudes;
> give surface details a larger data-depth than the part under them so
> they sit on its face.
