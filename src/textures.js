// Procedural canvas textures: wood, brushed metal, stone.
// Every texture is drawn in code at load time. No external image files.
// Each maker returns { map, bump }: a colour CanvasTexture and a matching
// grayscale bump CanvasTexture, both with RepeatWrapping. Repeats are set
// for ExtrudeGeometry UVs, which are in SVG shape units.

import * as THREE from 'three';

// Deterministic pseudo random so the textures are stable between renders.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePair(col, bmp, repeat) {
  const map = new THREE.CanvasTexture(col);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeat, repeat);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const bump = new THREE.CanvasTexture(bmp);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(repeat, repeat);
  return { map, bump };
}

function canvasPair(size) {
  const col = document.createElement('canvas'); col.width = col.height = size;
  const bmp = document.createElement('canvas'); bmp.width = bmp.height = size;
  return { col, bmp, c: col.getContext('2d'), b: bmp.getContext('2d') };
}

// Wood plank texture: colour map plus matching bump map.
// Adapted from the test4c treasure chest proof.
export function makeWood() {
  const S = 512, rows = 8, ph = S / rows;
  const { col, bmp, c, b } = canvasPair(S);
  const rand = rng(1234);
  b.fillStyle = '#8a8a8a'; b.fillRect(0, 0, S, S);
  for (let r = 0; r < rows; r++) {
    const y0 = r * ph;
    const tone = 0.82 + rand() * 0.36;
    c.fillStyle = `rgb(${Math.round(128 * tone)},${Math.round(82 * tone)},${Math.round(38 * tone)})`;
    c.fillRect(0, y0, S, ph);
    const g = Math.round(118 + rand() * 30);
    b.fillStyle = `rgb(${g},${g},${g})`;
    b.fillRect(0, y0, S, ph);
    // grain: long wavy horizontal strokes, dark and light
    for (let i = 0; i < 30; i++) {
      const gy = y0 + 4 + rand() * (ph - 8);
      const dark = rand() > 0.42;
      const amp = 1 + rand() * 2.4, per = 90 + rand() * 160, phz = rand() * 6.28;
      c.strokeStyle = dark ? 'rgba(46,24,6,0.34)' : 'rgba(255,205,130,0.20)';
      b.strokeStyle = dark ? 'rgba(40,40,40,0.5)' : 'rgba(210,210,210,0.4)';
      for (const ctx of [c, b]) {
        ctx.lineWidth = 1 + rand() * 1.6;
        ctx.beginPath();
        for (let x = 0; x <= S; x += 16) {
          const yy = gy + Math.sin(x / per * 6.28 + phz) * amp;
          x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    }
    // a knot on some rows
    if (rand() > 0.45) {
      const kx = 40 + rand() * (S - 80), ky = y0 + ph * (0.3 + rand() * 0.4);
      for (let k = 5; k > 0; k--) {
        c.strokeStyle = 'rgba(40,20,4,0.5)'; c.lineWidth = 1.6;
        c.beginPath(); c.ellipse(kx, ky, k * 3.4, k * 2.1, 0, 0, 6.29); c.stroke();
        b.strokeStyle = 'rgba(30,30,30,0.6)';
        b.beginPath(); b.ellipse(kx, ky, k * 3.4, k * 2.1, 0, 0, 6.29); b.stroke();
      }
      c.fillStyle = 'rgba(30,15,3,0.8)';
      c.beginPath(); c.ellipse(kx, ky, 3.4, 2.2, 0, 0, 6.29); c.fill();
    }
    // butt joint: staggered vertical seam in each row
    const jx = ((r * 197) % 380) + 60;
    c.fillStyle = 'rgba(24,12,2,0.85)'; c.fillRect(jx, y0, 4, ph);
    b.fillStyle = 'rgba(0,0,0,0.9)'; b.fillRect(jx, y0, 4, ph);
    // plank gap at the bottom of the row, with a highlight under it
    c.fillStyle = '#1d0f02'; c.fillRect(0, y0 + ph - 5, S, 5);
    c.fillStyle = 'rgba(255,215,150,0.28)'; c.fillRect(0, y0 + ph - 7, S, 2);
    b.fillStyle = '#000'; b.fillRect(0, y0 + ph - 5, S, 5);
  }
  return makePair(col, bmp, 0.012);
}

// Brushed metal texture. Adapted from the test4c treasure chest proof.
export function makeMetal() {
  const S = 256;
  const { col, bmp, c, b } = canvasPair(S);
  const rand = rng(777);
  c.fillStyle = '#43484f'; c.fillRect(0, 0, S, S);
  b.fillStyle = '#7d7d7d'; b.fillRect(0, 0, S, S);
  for (let i = 0; i < 340; i++) {
    const y = rand() * S, light = rand() > 0.5;
    c.strokeStyle = light ? 'rgba(210,220,235,0.13)' : 'rgba(8,10,14,0.16)';
    c.lineWidth = 0.8 + rand();
    c.beginPath(); c.moveTo(0, y); c.lineTo(S, y + (rand() - 0.5) * 6); c.stroke();
    b.strokeStyle = light ? 'rgba(200,200,200,0.25)' : 'rgba(50,50,50,0.25)';
    b.beginPath(); b.moveTo(0, y); b.lineTo(S, y); b.stroke();
  }
  for (let i = 0; i < 14; i++) { // scratches
    const x = rand() * S, y = rand() * S, len = 14 + rand() * 50;
    c.strokeStyle = 'rgba(225,232,242,0.35)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y + (rand() - 0.5) * 10); c.stroke();
  }
  return makePair(col, bmp, 0.05);
}

// Stone texture: light grey base, tonal patches, ashlar block joints,
// fine speckle and a few dark cracks. The bump map carries the joints,
// cracks and speckle so the surface reads as cut stone under a key light.
export function makeStone() {
  const S = 512;
  const { col, bmp, c, b } = canvasPair(S);
  const rand = rng(4242);
  c.fillStyle = '#a8abb0'; c.fillRect(0, 0, S, S);
  b.fillStyle = '#808080'; b.fillRect(0, 0, S, S);

  // large soft tonal patches
  for (let i = 0; i < 240; i++) {
    const x = rand() * S, y = rand() * S;
    const rx = 24 + rand() * 90, ry = 16 + rand() * 60;
    const v = 140 + Math.round(rand() * 60); // 140..200 grey
    c.fillStyle = `rgba(${v},${v},${v + 4},${0.05 + rand() * 0.08})`;
    c.beginPath(); c.ellipse(x, y, rx, ry, rand() * 3.2, 0, 6.29); c.fill();
    const bv = 96 + Math.round(rand() * 64);
    b.fillStyle = `rgba(${bv},${bv},${bv},0.10)`;
    b.beginPath(); b.ellipse(x, y, rx, ry, 0, 0, 6.29); b.fill();
  }

  // ashlar block joints: horizontal courses with staggered verticals
  const rows = 4, rh = S / rows;
  for (let r = 0; r <= rows; r++) {
    const y = r * rh;
    c.fillStyle = 'rgba(38,40,46,0.55)'; c.fillRect(0, y - 2, S, 4);
    c.fillStyle = 'rgba(255,255,255,0.16)'; c.fillRect(0, y + 2, S, 2);
    b.fillStyle = 'rgba(0,0,0,0.9)'; b.fillRect(0, y - 2, S, 4);
    if (r < rows) {
      const off = (r % 2) * (S / 4);
      for (let vx = off; vx < S + S / 2; vx += S / 2) {
        const x = vx % S;
        c.fillStyle = 'rgba(38,40,46,0.5)'; c.fillRect(x - 2, y, 4, rh);
        b.fillStyle = 'rgba(0,0,0,0.85)'; b.fillRect(x - 2, y, 4, rh);
      }
    }
  }

  // fine speckle
  for (let i = 0; i < 9000; i++) {
    const x = rand() * S, y = rand() * S, dark = rand() > 0.5;
    c.fillStyle = dark ? `rgba(40,42,48,${0.06 + rand() * 0.14})` : `rgba(235,238,242,${0.06 + rand() * 0.12})`;
    c.fillRect(x, y, 1.4, 1.4);
    const bv = dark ? 40 : 210;
    b.fillStyle = `rgba(${bv},${bv},${bv},0.25)`;
    b.fillRect(x, y, 1.4, 1.4);
  }

  // cracks: short random walks
  for (let i = 0; i < 12; i++) {
    let x = rand() * S, y = rand() * S, ang = rand() * 6.28;
    const steps = 5 + Math.floor(rand() * 8);
    for (const ctx of [c, b]) {
      ctx.strokeStyle = ctx === c ? 'rgba(30,32,38,0.5)' : 'rgba(20,20,20,0.7)';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x, y);
    }
    let cx = x, cy = y;
    const pts = [[cx, cy]];
    for (let sIdx = 0; sIdx < steps; sIdx++) {
      ang += (rand() - 0.5) * 1.1;
      cx += Math.cos(ang) * (8 + rand() * 12);
      cy += Math.sin(ang) * (8 + rand() * 12);
      pts.push([cx, cy]);
    }
    for (const ctx of [c, b]) {
      ctx.beginPath();
      pts.forEach(([px, py], j) => j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
      ctx.stroke();
    }
  }

  return makePair(col, bmp, 0.02);
}
