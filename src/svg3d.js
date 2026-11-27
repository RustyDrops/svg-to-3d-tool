// Core converter: real SVG markup in, extruded Three.js group out.
//
// Pipeline per drawable element (path, rect, circle, ellipse, line,
// polyline, polygon), in document order:
//   1. Resolve inherited attributes (data-depth, data-material, data-role,
//      fill, stroke, stroke-width, fill-rule, transform) from ancestors.
//   2. Rebuild the element alone in a mini SVG with those attributes set
//      explicitly and the accumulated transform on a wrapper group, then
//      parse it with SVGLoader to get subpaths with transforms baked in.
//   3. Sample each subpath to points, flip Y (SVG is y-down, Three is y-up).
//   4. Classify subpaths as solids or holes (fill-rule aware), build
//      THREE.Shape objects, extrude, place in Z, assign a material.
// Bad elements never throw: they are skipped with a warning and the rest
// of the design still builds.
//
// Recessed has two semantics. A recessed FILL layer is centred inside
// the base depth, so it sits mid-tunnel inside a hole (the castle gate
// portcullis). A recessed STROKE layer is engraved detail: it is placed
// on the front face of the fill element that hosts it, slightly proud,
// so the lines stay visible instead of burying inside the solid.
//
// An element can opt out of extrusion with data-mode (inherited):
//   data-mode="revolve" (fill): a solid of revolution (LatheGeometry)
//     from the largest solid outline, spun around the vertical line at
//     the outline's left edge.
//   data-mode="sphere" (fill): a sphere scaled to the outline bounding
//     box, with data-depth setting the z diameter.
//   data-mode="tube" (stroke): a TubeGeometry swept along each sampled
//     subpath, radius half the stroke width. Tubes ride on the front
//     surface of the design: the axis sits at the base front, slightly
//     embedded, so a tube drawn over a solid stays visible instead of
//     burying inside it.
// Any other data-mode value, or a mode on the wrong element kind, falls
// back to plain extrusion with a warning.

import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { makeWood, makeMetal, makeStone } from './textures.js';

const DRAWABLE = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'];
const INHERITED = ['data-depth', 'data-material', 'data-role', 'data-mode', 'data-anim', 'fill', 'stroke', 'stroke-width', 'fill-rule'];
// Class tokens that map to a viewer animation (see index.html anim engine).
// An explicit data-anim attribute (inherited) always wins over classes.
const CLASS_ANIM = { stars: 'twinkle', moon: 'bob', hills: 'drift', trees: 'sway', halo: 'pulse' };
const ALWAYS_CLOSED = ['rect', 'circle', 'ellipse', 'polygon'];
// Colour for an element that is filled but carries no fill colour of its
// own (absent fill attribute, no data-material). The SVG spec default is
// black; this neutral mid grey is used instead so bare pasted path data
// reads clearly under the scene lighting.
const DEFAULT_FILL_COLOUR = '#7d8590';

// ---------------------------------------------------------------- helpers

function parseStyleDecls(styleText) {
  const out = {};
  if (!styleText) return out;
  for (const part of styleText.split(';')) {
    const idx = part.indexOf(':');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

// Walk from the element up to the root svg, collecting the ancestor chain
// outermost first. Returns resolved attributes plus the joined transform.
function resolveDescriptor(el) {
  const chain = [];
  let node = el;
  while (node && node.nodeType === 1) {
    chain.unshift(node);
    if (node.tagName.toLowerCase() === 'svg') break;
    node = node.parentNode;
  }
  const desc = { hidden: false };
  for (const name of INHERITED) {
    let value;
    for (const n of chain) {
      const decls = parseStyleDecls(n.getAttribute('style'));
      if (decls[name] !== undefined) value = decls[name];
      else if (n.hasAttribute(name)) value = n.getAttribute(name);
    }
    if (value !== undefined) desc[name] = value;
  }
  for (const n of chain) {
    const decls = parseStyleDecls(n.getAttribute('style'));
    const disp = decls.display !== undefined ? decls.display : n.getAttribute('display');
    if (disp === 'none') desc.hidden = true;
  }
  desc.inDefs = chain.some(n => n.tagName.toLowerCase() === 'defs');
  // Animation name: explicit data-anim first, else the innermost class
  // token in the chain that CLASS_ANIM knows (halo on a window circle
  // beats the cottage group around it, and so on).
  if (!desc['data-anim']) {
    for (let i = chain.length - 1; i >= 0 && !desc['data-anim']; i--) {
      const cls = chain[i].getAttribute && chain[i].getAttribute('class');
      if (!cls) continue;
      for (const tok of cls.split(/\s+/)) {
        if (CLASS_ANIM[tok]) { desc['data-anim'] = CLASS_ANIM[tok]; break; }
      }
    }
  }
  desc.transform = chain
    .map(n => n.getAttribute('transform'))
    .filter(Boolean)
    .join(' ');
  return desc;
}

// Split path data into per-subpath closed flags (M starts, Z closes).
// Number tokens consume exponents, so an "e" inside a number is never
// mistaken for a command letter.
function pathClosedFlags(d) {
  const flags = [];
  let cur = -1;
  const tokens = d.match(/[MLHVCSQTAZmlhvcsqtaz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?|[\s,]+|./g) || [];
  for (const tok of tokens) {
    if (tok === 'M' || tok === 'm') { flags.push(false); cur = flags.length - 1; }
    else if ((tok === 'Z' || tok === 'z') && cur >= 0) flags[cur] = true;
  }
  return flags;
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > pt.y) !== (yj > pt.y) &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointSegDist(pt, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(pt.x - (a.x + dx * t), pt.y - (a.y + dy * t));
}

function pointInOrOnPolygon(pt, poly) {
  for (let i = 0; i < poly.length; i++) {
    if (pointSegDist(pt, poly[i], poly[(i + 1) % poly.length]) < 1e-6) return true;
  }
  return pointInPolygon(pt, poly);
}

// Proper segment crossing (shared endpoints and collinear overlaps ignored).
function segCross(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return { t, x: p1.x + d1x * t, y: p1.y + d1y * t };
}

function polysCross(a, b) {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

function bboxOf(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function bboxOverlap(a, b) {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

// ------------------------------------------------------- polygon union
// Union of two simple polygons, used to merge holes that overlap each
// other (a keyhole drawn as a circle plus a slot is the classic case).
// Method: split both outlines at their crossing points, drop the edge
// pieces that lie inside the other polygon, stitch what remains.

function augmentPoly(poly, other) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], bpt = poly[(i + 1) % n];
    out.push(a);
    const hits = [];
    for (let j = 0; j < other.length; j++) {
      const hit = segCross(a, bpt, other[j], other[(j + 1) % other.length]);
      if (hit) hits.push(hit);
    }
    hits.sort((p, q) => p.t - q.t);
    for (const h of hits) out.push({ x: h.x, y: h.y });
  }
  return out;
}

function keyOf(p) { return p.x.toFixed(5) + ',' + p.y.toFixed(5); }

function unionPolygons(aIn, bIn) {
  let a = aIn.slice(), b = bIn.slice();
  if (signedArea(a) < 0) a.reverse();
  if (signedArea(b) < 0) b.reverse();
  if (!polysCross(a, b)) {
    // No crossings: union is the outer polygon if one contains the other.
    if (pointInPolygon(a[0], b)) return b;
    if (pointInPolygon(b[0], a)) return a;
    return null; // disjoint
  }
  const augA = augmentPoly(a, b), augB = augmentPoly(b, a);
  const edges = [];
  const collect = (aug, other) => {
    for (let i = 0; i < aug.length; i++) {
      const p = aug[i], q = aug[(i + 1) % aug.length];
      if (dist(p, q) < 1e-9) continue;
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      if (!pointInPolygon(mid, other)) edges.push([p, q]);
    }
  };
  collect(augA, b);
  collect(augB, a);
  // Stitch edges into loops by matching endpoints.
  const byStart = new Map();
  edges.forEach((e, i) => {
    const k = keyOf(e[0]);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push(i);
  });
  const used = new Set();
  let best = null;
  for (let i = 0; i < edges.length; i++) {
    if (used.has(i)) continue;
    const loop = [];
    let cur = i, guard = 0;
    while (cur !== -1 && !used.has(cur) && guard++ < edges.length + 2) {
      used.add(cur);
      const e = edges[cur];
      if (!loop.length) loop.push(e[0]);
      loop.push(e[1]);
      const nexts = byStart.get(keyOf(e[1])) || [];
      cur = nexts.find(n => !used.has(n));
      if (cur === undefined) cur = -1;
    }
    if (loop.length > 3) {
      loop.pop(); // last point repeats the first
      if (!best || Math.abs(signedArea(loop)) > Math.abs(signedArea(best))) best = loop;
    }
  }
  return best;
}

function holesOverlap(a, b) {
  if (!bboxOverlap(bboxOf(a), bboxOf(b))) return false;
  if (polysCross(a, b)) return true;
  return pointInPolygon(a[0], b) || pointInPolygon(b[0], a);
}

// Merge overlapping holes pairwise until none overlap. Returns new list.
function mergeOverlappingHoles(holes) {
  const list = holes.slice();
  let changed = true, guard = 0;
  while (changed && guard++ < 64) {
    changed = false;
    outer:
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (holesOverlap(list[i], list[j])) {
          const merged = unionPolygons(list[i], list[j]);
          if (merged && merged.length >= 3) {
            list.splice(j, 1);
            list[i] = merged;
            changed = true;
            break outer;
          }
        }
      }
    }
  }
  return list;
}

// ------------------------------------------------------------- sampling

// Sample a THREE.Path (one SVGLoader subpath) into a point list in
// Three orientation: x stays, y is negated (SVG y-down becomes y-up).
function sampleSubPath(subPath) {
  const pts = [];
  const curves = subPath.curves || [];
  for (const curve of curves) {
    let n;
    if (curve.isLineCurve) n = 1;
    else {
      let len = 10;
      try { len = curve.getLength(); } catch (e) { /* keep default */ }
      n = Math.max(4, Math.min(64, Math.ceil(len / 3)));
    }
    const cp = curve.getPoints(n);
    for (let i = 0; i < cp.length; i++) {
      if (i === 0 && pts.length) continue; // joint point already added
      pts.push({ x: cp[i].x, y: -cp[i].y });
    }
  }
  // Drop consecutive duplicates and a closing repeat of the first point.
  const out = [];
  for (const p of pts) {
    if (!out.length || dist(p, out[out.length - 1]) > 1e-5) out.push(p);
  }
  if (out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-4) out.pop();
  return out;
}

// Was this subpath closed in the source? Element type first, then the
// path data flags, then a geometric fallback.
function subPathClosed(el, tag, index, flags, pts) {
  if (ALWAYS_CLOSED.includes(tag)) return true;
  if (tag === 'line' || tag === 'polyline') return false;
  if (tag === 'path' && flags && flags.length) {
    if (index < flags.length) return flags[index];
  }
  if (pts.length < 2) return false;
  const bb = bboxOf(pts);
  const diag = Math.hypot(bb.w, bb.h) || 1;
  return dist(pts[0], pts[pts.length - 1]) < Math.max(0.05 * diag, 1e-6);
}

// ------------------------------------------------------------ materials

function colourOrNull(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (!v || v === 'none' || v === 'transparent' || v === 'currentColor') return null;
  if (v.startsWith('url(')) return null;
  try {
    const c = new THREE.Color();
    c.setStyle(v);
    if (Number.isNaN(c.r) || Number.isNaN(c.g) || Number.isNaN(c.b)) return null;
    return v;
  } catch (e) {
    return null;
  }
}

function makeMaterialContext(opts) {
  return { flat: !!opts.flatTextures, cache: new Map(), texCache: new Map() };
}

function getTexture(ctx, kind) {
  if (!ctx.texCache.has(kind)) {
    ctx.texCache.set(kind, kind === 'wood' ? makeWood() : kind === 'stone' ? makeStone() : makeMetal());
  }
  return ctx.texCache.get(kind);
}

function materialFor(ctx, name, effColour) {
  const key = (name || '') + '|' + (effColour || '') + '|' + (ctx.flat ? 'flat' : 'tex');
  if (ctx.cache.has(key)) return ctx.cache.get(key);
  const col = effColour ? new THREE.Color(effColour) : null;
  let m;
  switch (name) {
    case 'steel':
      m = new THREE.MeshStandardMaterial({ color: col || new THREE.Color(0x8a97a5), metalness: 0.35, roughness: 0.38 });
      break;
    case 'gold':
      m = new THREE.MeshStandardMaterial({ color: col || new THREE.Color(0xd9b45b), metalness: 0.85, roughness: 0.3 });
      break;
    case 'copper':
      m = new THREE.MeshStandardMaterial({ color: col || new THREE.Color(0xb87333), metalness: 0.85, roughness: 0.35 });
      break;
    case 'gem': {
      const cc = col || new THREE.Color(0xc22e3a);
      m = new THREE.MeshStandardMaterial({
        color: cc, metalness: 0.2, roughness: 0.15,
        emissive: cc.clone().multiplyScalar(0.3)
      });
      break;
    }
    case 'iron':
      if (ctx.flat) {
        m = new THREE.MeshStandardMaterial({ color: col || new THREE.Color(0x565d66), metalness: 0.7, roughness: 0.5 });
      } else {
        const t = getTexture(ctx, 'metal');
        // The metal texture base is dark (#43484f in textures.js), and the
        // renderer multiplies map by color, so tinting with the raw fill
        // double-darkens iron to near black. Compensate by dividing the
        // fill (in linear space) by the texture base colour, so the
        // combined albedo lands back on the requested fill: a mid-grey
        // fill reads as brushed iron, a dark fill stays dark but visible.
        const texBase = new THREE.Color(0x43484f);
        const base = col || new THREE.Color(0x8a9097);
        const tint = new THREE.Color(
          Math.min(base.r / texBase.r, 4),
          Math.min(base.g / texBase.g, 4),
          Math.min(base.b / texBase.b, 4)
        );
        m = new THREE.MeshStandardMaterial({
          map: t.map, bumpMap: t.bump, bumpScale: 1,
          color: tint, metalness: 0.6, roughness: 0.5
        });
      }
      break;
    case 'metal':
      if (ctx.flat) {
        m = new THREE.MeshStandardMaterial({ color: 0x8b939c, metalness: 0.78, roughness: 0.46 });
      } else {
        const t = getTexture(ctx, 'metal');
        m = new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 1, metalness: 0.78, roughness: 0.46 });
      }
      break;
    case 'wood':
      if (ctx.flat) {
        m = new THREE.MeshStandardMaterial({ color: col || new THREE.Color(0x8a5a2e), metalness: 0.02, roughness: 0.85 });
      } else {
        const t = getTexture(ctx, 'wood');
        m = new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 3, metalness: 0.02, roughness: 0.82 });
      }
      break;
    case 'stone':
      if (ctx.flat) {
        m = new THREE.MeshStandardMaterial({ color: col || new THREE.Color(0x7a8699), metalness: 0.05, roughness: 0.9 });
      } else {
        const t = getTexture(ctx, 'stone');
        m = new THREE.MeshStandardMaterial({
          map: t.map, bumpMap: t.bump, bumpScale: 2,
          color: col || new THREE.Color(0xffffff), metalness: 0.05, roughness: 0.88
        });
      }
      break;
    default:
      m = new THREE.MeshStandardMaterial({ color: col || new THREE.Color(0x888888), metalness: 0.1, roughness: 0.6 });
      break;
  }
  ctx.cache.set(key, m);
  return m;
}

// -------------------------------------------------------------- builder

function shapeFromPoints(pts) {
  return new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, p.y)));
}

function holeFromPoints(pts) {
  return new THREE.Path(pts.map(p => new THREE.Vector2(p.x, p.y)));
}

// Build filled shapes for one element from its sampled subpaths.
// Returns an array of THREE.Shape. Pushes warnings as needed.
function buildFillShapes(subs, fillRule, label, warnings) {
  // Classify each subpath.
  const items = subs.map((s, i) => {
    const containers = [];
    for (let j = 0; j < subs.length; j++) {
      if (j === i) continue;
      if (!pointInPolygon(s.pts[0], subs[j].pts)) continue;
      // A subpath that crosses this one is not a nesting container, even
      // when this subpath's first point happens to lie inside it. Crossing
      // subpaths are resolved later instead: overlapping holes are merged
      // by mergeOverlappingHoles, overlapping solids extrude separately.
      // Counting a crossed subpath here would misclassify the second of
      // two overlapping holes (a circle plus slot keyhole, say) as a
      // solid plug, because its first point sits inside the first hole.
      if (polysCross(s.pts, subs[j].pts)) continue;
      containers.push(j);
    }
    return { ...s, index: i, containers, type: null };
  });
  for (const it of items) {
    if (fillRule === 'evenodd') {
      const insideCount = it.containers.length + 1;
      it.type = insideCount % 2 === 1 ? 'solid' : 'hole';
    } else {
      // nonzero: winding number just inside vs just outside this subpath.
      const own = Math.sign(it.area) || 1;
      let wOut = 0;
      for (const j of it.containers) wOut += Math.sign(items[j].area) || 1;
      const wIn = wOut + own;
      if (wIn !== 0 && wOut === 0) it.type = 'solid';
      else if (wIn === 0 && wOut !== 0) it.type = 'hole';
      else if (wIn !== 0 && wOut !== 0) it.type = 'solid'; // interior overlap, extrude separately
      else it.type = 'skip';
    }
  }
  const shapes = [];
  const solids = items.filter(it => it.type === 'solid');
  const holes = items.filter(it => it.type === 'hole');
  for (const it of items) {
    if (it.type === 'skip') warnings.push(label + ': subpath ' + it.index + ' encloses no filled area, skipped.');
  }
  // Assign each hole to the smallest containing solid.
  const holesBySolid = new Map();
  for (const h of holes) {
    let best = null, bestArea = Infinity;
    for (const s of solids) {
      if (pointInPolygon(h.pts[0], s.pts) && Math.abs(s.area) < bestArea) {
        best = s; bestArea = Math.abs(s.area);
      }
    }
    if (!best) {
      warnings.push(label + ': hole subpath ' + h.index + ' has no containing shape, treated as a solid.');
      solids.push(h);
      if (!holesBySolid.has(h.index)) holesBySolid.set(h.index, []);
      continue;
    }
    if (!holesBySolid.has(best.index)) holesBySolid.set(best.index, []);
    holesBySolid.get(best.index).push(h);
  }
  for (const s of solids) {
    const shape = shapeFromPoints(s.pts);
    let holeList = (holesBySolid.get(s.index) || []).map(h => h.pts);
    if (holeList.length > 1) holeList = mergeOverlappingHoles(holeList);
    for (const hPts of holeList) {
      // Guard: a hole that pokes outside its solid can corrupt the
      // triangulation of the whole shape. Drop it rather than break all.
      const fullyInside = hPts.every(p => pointInOrOnPolygon(p, s.pts)) && !polysCross(hPts, s.pts);
      if (!fullyInside) {
        warnings.push(label + ': a hole extends outside its shape and was dropped to protect the triangulation.');
        continue;
      }
      shape.holes.push(holeFromPoints(hPts));
    }
    shapes.push(shape);
  }
  return shapes;
}

// Build quad shapes for one stroke-only element. Each segment becomes a
// rectangle of width stroke-width, extended by half width at both ends
// so joints overlap instead of gapping.
function buildStrokeShapes(subs, width) {
  const shapes = [];
  const hw = width / 2;
  for (const s of subs) {
    const pts = s.pts;
    const segCount = s.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segCount; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const ux = dx / len, uy = dy / len;
      const nx = -uy * hw, ny = ux * hw;
      const corners = [
        { x: p1.x + nx - ux * hw, y: p1.y + ny - uy * hw },
        { x: p2.x + nx + ux * hw, y: p2.y + ny + uy * hw },
        { x: p2.x - nx + ux * hw, y: p2.y - ny + uy * hw },
        { x: p1.x - nx - ux * hw, y: p1.y - ny - uy * hw }
      ];
      shapes.push(shapeFromPoints(corners));
    }
  }
  return shapes;
}

// Load one element's sampled subpaths: rebuild the element alone in a
// mini SVG with its inherited presentation attributes set explicitly and
// the accumulated transform on a wrapper group, parse it with SVGLoader
// (transforms baked in), and sample each subpath. Returns the sub list,
// or null when SVGLoader produced no path. Warnings go to the array
// passed in, so a pre-pass can pass a throwaway array.
function loadSubs(p, viewBox, loader, serializer, label, warnings) {
  const clone = p.el.cloneNode(false);
  clone.removeAttribute('transform');
  for (const name of ['fill', 'stroke', 'stroke-width', 'fill-rule']) {
    if (p.desc[name] !== undefined) clone.setAttribute(name, p.desc[name]);
  }
  const cloneText = serializer.serializeToString(clone);
  const wrapped = p.desc.transform
    ? '<g transform="' + p.desc.transform + '">' + cloneText + '</g>'
    : cloneText;
  const mini = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + viewBox + '">' + wrapped + '</svg>';
  const parsed = loader.parse(mini);
  if (!parsed.paths || !parsed.paths.length) {
    warnings.push(label + ': SVGLoader produced no path, skipped.');
    return null;
  }
  const shapePath = parsed.paths[0];
  const flags = p.tag === 'path' ? pathClosedFlags(p.el.getAttribute('d') || '') : null;
  const subs = [];
  shapePath.subPaths.forEach((subPath, si) => {
    const pts = sampleSubPath(subPath);
    if (pts.length < 2) {
      warnings.push(label + ': subpath ' + si + ' has too few points, skipped.');
      return;
    }
    const closed = subPathClosed(p.el, p.tag, si, flags, pts);
    subs.push({ pts, closed, area: signedArea(pts) });
  });
  return subs;
}

// Is this element built as stroke segment quads rather than filled
// shapes? Mirrors the stroke-only test in the main build pass.
function isStrokeElement(desc, tag) {
  const fill = desc.fill;
  const stroke = desc.stroke;
  const fillIsNone = fill !== undefined && String(fill).trim().toLowerCase() === 'none';
  const hasStroke = stroke !== undefined && String(stroke).trim().toLowerCase() !== 'none';
  if (!hasStroke) return false;
  if (tag === 'line' || tag === 'polyline') return true;
  return fillIsNone || fill === undefined;
}

function countNaN(geometry) {
  const arr = geometry.attributes.position.array;
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) n++;
  return n;
}

// Add one element's meshes to the model. When the element carries an
// animation name, its meshes are wrapped in a pivot group placed at the
// element bounding-box bottom centre (x centre for bob/pulse), with the
// geometry shifted so the pivot sits at the group origin. The viewer
// animates the pivot; the static position is pivot.position itself, so
// exports stay correct when animation is off. userData.home records the
// rest transform and a per-element phase.
let animSeq = 0;
function addElementMeshes(inner, meshes, p, stats) {
  const anim = String(p.desc['data-anim'] || '').trim().toLowerCase();
  if (!anim || !meshes.length) { for (const m of meshes) inner.add(m); return; }
  const box = new THREE.Box3();
  for (const m of meshes) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); }
  const cx = (box.min.x + box.max.x) / 2;
  const pivot = new THREE.Group();
  pivot.name = 'anim_' + (animSeq++) + '_' + anim;
  pivot.position.set(cx, box.min.y, 0);
  for (const m of meshes) {
    m.geometry.translate(-cx, -box.min.y, 0);
    pivot.add(m);
  }
  pivot.userData.anim = anim;
  pivot.userData.phase = (p.index * 0.83) % (Math.PI * 2);
  pivot.userData.home = { x: cx, y: box.min.y, z: 0 };
  inner.add(pivot);
  stats.animElements++;
}

// Main entry point.
// svgText: full SVG markup.
// options: { defaultDepth, depthMultiplier, bevel, flatTextures,
//            materialOverrides } where materialOverrides maps an element
//            index or a material name to a replacement material name.
// Returns { group, warnings, stats: { elements, meshes, triangles, nanVertices } }.
export function buildFromSVG(svgText, options = {}) {
  const opts = {
    defaultDepth: 20,
    depthMultiplier: 1,
    bevel: true,
    flatTextures: false,
    materialOverrides: null,
    layered: false,
    layerGap: 10,
    paperDepth: 6,
    ...options
  };
  const warnings = [];
  const stats = { elements: 0, meshes: 0, triangles: 0, nanVertices: 0, animElements: 0 };
  const inner = new THREE.Group();

  let doc;
  try {
    doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  } catch (e) {
    warnings.push('SVG could not be parsed: ' + e.message);
    return { group: inner, warnings, stats };
  }
  const rootEl = doc.documentElement;
  if (!rootEl || rootEl.tagName.toLowerCase() === 'parsererror' || doc.querySelector('parsererror')) {
    warnings.push('SVG could not be parsed: not valid XML.');
    return { group: inner, warnings, stats };
  }
  const svgEl = rootEl.tagName.toLowerCase() === 'svg' ? rootEl : doc.querySelector('svg');
  if (!svgEl) {
    warnings.push('No <svg> element found in the input.');
    return { group: inner, warnings, stats };
  }
  const viewBox = svgEl.getAttribute('viewBox') || '0 0 100 100';
  // Layered scenes (opt-in: options.layered or data-layered="true" on
  // the root svg): every element becomes a thin paper sheet, stacked in
  // document order with a z gap between sheets, like a paper diorama.
  const layered = !!opts.layered || String(svgEl.getAttribute('data-layered') || '').toLowerCase() === 'true';

  const elements = [];
  const walker = svgEl.querySelectorAll(DRAWABLE.join(','));
  walker.forEach(el => elements.push(el));
  stats.elements = elements.length;

  // First pass: resolve descriptors and depths, find the base depth used
  // to centre recessed layers.
  const loader = new SVGLoader();
  const serializer = new XMLSerializer();
  const prepared = elements.map((el, index) => {
    const desc = resolveDescriptor(el);
    const rawDepth = parseFloat(desc['data-depth']);
    const fallbackDepth = layered ? opts.paperDepth : opts.defaultDepth;
    const depth = (Number.isFinite(rawDepth) ? rawDepth : fallbackDepth) * opts.depthMultiplier;
    const zBase = layered ? index * opts.layerGap * opts.depthMultiplier : 0;
    return { el, index, desc, depth, zBase, tag: el.tagName.toLowerCase() };
  });
  let baseDepth = 0;
  for (const p of prepared) {
    if (p.desc['data-role'] !== 'recessed' && p.depth > baseDepth) baseDepth = p.depth;
  }
  if (baseDepth <= 0) baseDepth = opts.defaultDepth * opts.depthMultiplier;

  // Host pre-pass for recessed stroke placement: for every fill element
  // with no role or role base (never raised, never recessed, never a
  // stroke), record its outer solid outline and its depth. A recessed
  // stroke element is later placed on the front face of the host whose
  // outline contains the stroke bounding-box centre. Depths here are
  // the prepared depths, so the depth multiplier is already applied.
  const hosts = [];
  for (const p of prepared) {
    const role = p.desc['data-role'];
    if (role !== undefined && role !== 'base') continue;
    if (p.desc.inDefs || p.desc.hidden) continue;
    if (isStrokeElement(p.desc, p.tag)) continue;
    try {
      const dummyWarnings = [];
      const label = 'Element ' + p.index + ' (' + p.tag + ')';
      const subs = loadSubs(p, viewBox, loader, serializer, label, dummyWarnings);
      if (!subs || !subs.length) continue;
      const usable = subs.filter(s => s.pts.length >= 3 && Math.abs(s.area) >= 1e-6);
      if (!usable.length) continue;
      const fillRule = (p.desc['fill-rule'] || 'nonzero').toLowerCase() === 'evenodd' ? 'evenodd' : 'nonzero';
      const shapes = buildFillShapes(usable, fillRule, label, dummyWarnings);
      let outline = null, outlineArea = 0;
      for (const shape of shapes) {
        const pts = shape.extractPoints(24).shape.map(v => ({ x: v.x, y: v.y }));
        const a = Math.abs(signedArea(pts));
        if (a > outlineArea) { outline = pts; outlineArea = a; }
      }
      if (outline && outline.length >= 3) hosts.push({ depth: p.depth, outline, area: outlineArea });
    } catch (err) { /* not a host; the main pass reports the failure */ }
  }

  const matCtx = makeMaterialContext(opts);

  // Second pass: build geometry per element.
  for (const p of prepared) {
    const label = 'Element ' + p.index + ' (' + p.tag + ')';
    try {
      if (p.desc.inDefs) continue;
      if (p.desc.hidden) { warnings.push(label + ': hidden (display none), skipped.'); continue; }

      const fill = p.desc.fill;
      const stroke = p.desc.stroke;
      // Three fill cases, per the SVG spec:
      //   explicit fill: desc.fill is a colour or paint value, use it.
      //   explicit none: desc.fill is the string 'none'. desc is already
      //     inheritance-resolved, so this covers fill="none" set on the
      //     element itself or on an ancestor group, unless a closer
      //     element overrode it with its own fill.
      //   absent fill: desc.fill is undefined. The spec default is a
      //     black fill, NOT no fill, so the element counts as filled
      //     (hasFill below) and gets DEFAULT_FILL_COLOUR as its colour.
      const fillIsNone = fill !== undefined && String(fill).trim().toLowerCase() === 'none';
      const hasFill = !fillIsNone;
      const hasStroke = stroke !== undefined && String(stroke).trim().toLowerCase() !== 'none';
      const isStrokeOnly =
        (p.tag === 'line' || p.tag === 'polyline') ? hasStroke
        : ((fillIsNone || fill === undefined) && hasStroke);
      if (!hasFill && !hasStroke) {
        warnings.push(label + ': no fill and no stroke, skipped.');
        continue;
      }
      if (fill && String(fill).startsWith('url(')) {
        warnings.push(label + ': pattern or gradient fill is not supported, using a flat colour.');
      }

      // Mini SVG: the element alone, inherited presentation attributes
      // set explicitly, accumulated transform on a wrapper group.
      const subs = loadSubs(p, viewBox, loader, serializer, label, warnings);
      if (!subs || !subs.length) continue;

      let shapes = [];
      if (isStrokeOnly) {
        const wRaw = parseFloat(p.desc['stroke-width']);
        const width = Number.isFinite(wRaw) ? wRaw : 1;
        shapes = buildStrokeShapes(subs, width);
      } else {
        for (const s of subs) {
          if (!s.closed) {
            warnings.push(label + ': open subpath auto-closed (missing Z).');
          }
        }
        const usable = subs.filter(s => {
          if (s.pts.length < 3 || Math.abs(s.area) < 1e-6) {
            warnings.push(label + ': zero-area subpath skipped.');
            return false;
          }
          return true;
        });
        if (!usable.length) continue;
        const fillRule = (p.desc['fill-rule'] || 'nonzero').toLowerCase() === 'evenodd' ? 'evenodd' : 'nonzero';
        shapes = buildFillShapes(usable, fillRule, label, warnings);
      }
      if (!shapes.length) continue;

      // Material: overrides win, then data-material, then fill colour.
      let matName = p.desc['data-material'] || null;
      if (opts.materialOverrides) {
        if (opts.materialOverrides[p.index]) matName = opts.materialOverrides[p.index];
        else if (matName && opts.materialOverrides[matName]) matName = opts.materialOverrides[matName];
      }
      const effColour = colourOrNull(p.desc.fill) || colourOrNull(p.desc.stroke) ||
        (!matName && hasFill && !hasStroke ? DEFAULT_FILL_COLOUR : null);
      const material = materialFor(matCtx, matName, effColour);

      // Non-extrusion build modes (opt-in via data-mode). These replace
      // only the shape-to-geometry step for this element; warnings,
      // stats and material resolution stay shared with extrusion. A
      // mode on the wrong element kind warns and falls back to the
      // normal extrusion below. No data-mode (or an unrecognised one)
      // skips this block entirely and follows the original path.
      const mode = String(p.desc['data-mode'] || '').trim().toLowerCase();
      let modeGeos = null;
      if (mode === 'revolve' || mode === 'sphere') {
        if (isStrokeOnly) {
          warnings.push(label + ': data-mode ' + mode + ' needs a filled outline, extruded instead.');
        } else if (mode === 'revolve') {
          // Profile: the largest solid outline, spun around the
          // vertical line at its left edge (x = minX).
          let outline = null, outlineArea = 0;
          for (const shape of shapes) {
            const pts = shape.extractPoints(24).shape.map(v => ({ x: v.x, y: v.y }));
            const a = Math.abs(signedArea(pts));
            if (a > outlineArea) { outline = pts; outlineArea = a; }
          }
          if (outline && outline.length >= 2) {
            const minX = bboxOf(outline).minX;
            const lathePts = outline.map(pt => new THREE.Vector2(Math.max(0, pt.x - minX), pt.y));
            const geo = new THREE.LatheGeometry(lathePts, 48);
            geo.translate(minX, 0, 0);
            modeGeos = [geo];
          } else {
            warnings.push(label + ': data-mode revolve needs a filled outline, extruded instead.');
          }
        } else {
          // Sphere scaled to the element outline bounding box; the
          // resolved depth sets the z diameter, and the centre sits at
          // z depth/2 so the ball occupies the extrusion z range.
          const allPts = [];
          for (const s of subs) for (const pt of s.pts) allPts.push(pt);
          const bb = bboxOf(allPts);
          const geo = new THREE.SphereGeometry(1, 40, 28);
          geo.scale(bb.w / 2, bb.h / 2, p.depth / 2);
          geo.translate((bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2, p.depth / 2);
          modeGeos = [geo];
        }
      } else if (mode === 'tube') {
        if (!isStrokeOnly) {
          warnings.push(label + ': data-mode tube needs a stroke-only element, extruded instead.');
        } else {
          const wRaw = parseFloat(p.desc['stroke-width']);
          const width = Number.isFinite(wRaw) ? wRaw : 1;
          const radius = width / 2;
          // The tube axis rides on the front of the design: the base
          // front face sits at baseDepth plus its bevel thickness, and
          // the axis is embedded by a fraction of the radius so the
          // tube stays attached to the surface instead of floating.
          const bevelEnabled = !!opts.bevel;
          const axisZ = baseDepth + (bevelEnabled ? Math.min(3, baseDepth * 0.12) : 0) - radius * 0.35;
          modeGeos = [];
          for (const s of subs) {
            if (s.pts.length < 2) continue;
            const curvePts = s.pts.map(pt => new THREE.Vector3(pt.x, pt.y, axisZ));
            const curve = new THREE.CatmullRomCurve3(curvePts, !!s.closed);
            modeGeos.push(new THREE.TubeGeometry(
              curve, Math.max(16, s.pts.length * 2), width / 2, 10, !!s.closed));
          }
          if (!modeGeos.length) modeGeos = null;
        }
      }
      if (modeGeos) {
        const made = [];
        for (const geo of modeGeos) {
          if (p.zBase) geo.translate(0, 0, p.zBase);
          stats.nanVertices += countNaN(geo);
          const pos = geo.attributes.position;
          stats.triangles += Math.round((geo.index ? geo.index.count : pos.count) / 3);
          const mesh = new THREE.Mesh(geo, material);
          mesh.name = label;
          made.push(mesh);
          stats.meshes++;
        }
        addElementMeshes(inner, made, p, stats);
        continue;
      }

      // Z placement: base and raised layers sit on z 0..depth (a raised
      // element simply has a larger data-depth and so protrudes).
      // Recessed FILL layers are centred inside the base depth, so they
      // sit mid-tunnel inside a hole. Recessed STROKE layers are
      // engraved detail: they go on the front face of their host (the
      // largest-area base fill element whose outer outline contains
      // the stroke bounding-box centre), starting 0.5 inside the host
      // front and extruding min(depth, 2), so with a depth of 2 or
      // more the line front sits 1.5 proud of the host face. The host
      // front face itself sits at hostDepth + hostBevelThickness,
      // because the bevel extends past the nominal depth on both
      // ends, so the start accounts for that thickness. With no
      // host, a recessed stroke falls back to the centred placement.
      let extrudeDepth = p.depth;
      let zStart = 0;
      if (p.desc['data-role'] === 'recessed' && isStrokeOnly) {
        const allPts = [];
        for (const s of subs) for (const pt of s.pts) allPts.push(pt);
        const sbb = bboxOf(allPts);
        const centre = { x: (sbb.minX + sbb.maxX) / 2, y: (sbb.minY + sbb.maxY) / 2 };
        let host = null;
        for (const h of hosts) {
          if (pointInPolygon(centre, h.outline) && (!host || h.area > host.area)) host = h;
        }
        if (host) {
          extrudeDepth = Math.min(p.depth, 2);
          const hostBevelThickness = (opts.bevel && host.depth > 0) ? Math.min(3, host.depth * 0.12) : 0;
          zStart = Math.max(0, host.depth + hostBevelThickness - 0.5);
        } else {
          zStart = Math.max(0, (baseDepth - p.depth) / 2);
        }
      } else if (p.desc['data-role'] === 'recessed') {
        zStart = Math.max(0, (baseDepth - p.depth) / 2);
      }

      const madeMeshes = [];
      for (const shape of shapes) {
        const bb = bboxOf(shape.getPoints(12).map(v => ({ x: v.x, y: v.y })));
        const minDim = Math.min(bb.w, bb.h);
        let bevelSize = 0, bevelThickness = 0;
        if (opts.bevel && extrudeDepth > 0) {
          // Spec formula, clamped so small shapes (dots, tiny stars,
          // thin stroke quads) are not destroyed by their own bevel.
          bevelSize = Math.min(3, extrudeDepth * 0.12, Math.max(0, minDim) * 0.1);
          bevelThickness = Math.min(3, extrudeDepth * 0.12);
          if (bevelSize < 0.01) { bevelSize = 0; bevelThickness = 0; }
        }
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: extrudeDepth,
          steps: 1,
          bevelEnabled: bevelSize > 0,
          bevelThickness,
          bevelSize,
          bevelSegments: 2,
          curveSegments: 24
        });
        geo.translate(0, 0, zStart + p.zBase);
        stats.nanVertices += countNaN(geo);
        const pos = geo.attributes.position;
        stats.triangles += Math.round((geo.index ? geo.index.count : pos.count) / 3);
        const mesh = new THREE.Mesh(geo, material);
        mesh.name = label;
        madeMeshes.push(mesh);
        stats.meshes++;
      }
      addElementMeshes(inner, madeMeshes, p, stats);
    } catch (err) {
      warnings.push(label + ': failed to build (' + (err && err.message ? err.message : err) + '), skipped.');
    }
  }

  if (!inner.children.length) {
    warnings.push('Nothing could be built from this SVG.');
    return { group: inner, warnings, stats };
  }

  // Centre on the bounding box and scale so the largest dimension is 2.4.
  const box = new THREE.Box3().setFromObject(inner);
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 2.4 / maxDim;
  inner.scale.setScalar(scale);
  inner.position.set(-centre.x * scale, -centre.y * scale, -centre.z * scale);
  const outer = new THREE.Group();
  outer.add(inner);
  return { group: outer, warnings, stats };
}
