import * as THREE from 'three';

// Four sculptures, all written rather than modelled — and all evaluated over
// the SAME grid, sharing one index buffer. That is the whole trick behind the
// morph: switching form is a lerp from one position array into another, not a
// swap to a different mesh. Nothing is cut, so nothing has to be hidden.

const TAU = Math.PI * 2;

export const ROWS = 448;  // along the sweep: the knot's path, the column's height
export const RING = 80;   // around the section
const COUNT = (ROWS + 1) * RING;

// The grid is stitched as an open tube. Forms that close on themselves (the
// knot, the band) simply place their last row exactly on top of their first —
// there is no gap to bridge, so no wrap-around quads are needed, and the index
// buffer stays identical for every form.
let indexCache = null;
export function gridIndex() {
  if (indexCache) return indexCache;
  const index = new Uint32Array(ROWS * RING * 6);
  let k = 0;
  for (let i = 0; i < ROWS; i++) {
    for (let j = 0; j < RING; j++) {
      const j2 = (j + 1) % RING;
      const a = i * RING + j;
      const b = i * RING + j2;
      const c = (i + 1) * RING + j;
      const d = (i + 1) * RING + j2;
      index[k++] = a; index[k++] = c; index[k++] = b;
      index[k++] = b; index[k++] = c; index[k++] = d;
    }
  }
  indexCache = index;
  return index;
}

function surface(place) {
  const position = new Float32Array(COUNT * 3);
  const p = new THREE.Vector3();
  let k = 0;
  for (let i = 0; i <= ROWS; i++) {
    const v = i / ROWS;
    for (let j = 0; j < RING; j++) {
      place(v, (j / RING) * TAU, p);
      position[k++] = p.x;
      position[k++] = p.y;
      position[k++] = p.z;
    }
  }
  return position;
}

// Centre on the origin and scale to a unit bounding sphere. Every form ends up
// the same size in the same place, so the camera never moves and the mesh can
// keep one fixed bounding sphere through the whole morph.
function normalise(position) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < position.length; i += 3) {
    if (position[i] < minX) minX = position[i];
    if (position[i] > maxX) maxX = position[i];
    if (position[i + 1] < minY) minY = position[i + 1];
    if (position[i + 1] > maxY) maxY = position[i + 1];
    if (position[i + 2] < minZ) minZ = position[i + 2];
    if (position[i + 2] > maxZ) maxZ = position[i + 2];
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;

  let farthest = 0;
  for (let i = 0; i < position.length; i += 3) {
    const dx = position[i] - cx, dy = position[i + 1] - cy, dz = position[i + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > farthest) farthest = d;
  }
  const scale = 1 / (Math.sqrt(farthest) || 1);

  for (let i = 0; i < position.length; i += 3) {
    position[i] = (position[i] - cx) * scale;
    position[i + 1] = (position[i + 1] - cy) * scale;
    position[i + 2] = (position[i + 2] - cz) * scale;
  }
  return position;
}

// Coincident vertices — a closed loop's seam, a collapsed pole, the half-ring
// offset where the Möbius meets itself — are still separate entries in the
// shared grid, so computeVertexNormals leaves a shading crease across them.
// On a mirror that crease is glaring. Average each coincident group instead.
function healSeams(position, normal) {
  const groups = new Map();
  for (let i = 0; i < COUNT; i++) {
    const key = `${Math.round(position[i * 3] * 1e5)},${Math.round(position[i * 3 + 1] * 1e5)},${Math.round(position[i * 3 + 2] * 1e5)}`;
    const group = groups.get(key);
    if (group) group.push(i);
    else groups.set(key, [i]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    let nx = 0, ny = 0, nz = 0;
    for (const i of group) {
      nx += normal[i * 3];
      ny += normal[i * 3 + 1];
      nz += normal[i * 3 + 2];
    }
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-8) continue;
    nx /= len; ny /= len; nz /= len;
    for (const i of group) {
      normal[i * 3] = nx;
      normal[i * 3 + 1] = ny;
      normal[i * 3 + 2] = nz;
    }
  }
}

function normalsFor(position) {
  const scratch = new THREE.BufferGeometry();
  scratch.setIndex(new THREE.BufferAttribute(gridIndex(), 1));
  scratch.setAttribute('position', new THREE.BufferAttribute(position, 3));
  scratch.computeVertexNormals();
  const normal = new Float32Array(scratch.attributes.normal.array);
  scratch.dispose();
  healSeams(position, normal);
  return normal;
}

// Radius of a superellipse — n = 2 is a circle, n = 6 a rounded square.
const superellipse = (angle, n) =>
  Math.pow(Math.pow(Math.abs(Math.cos(angle)), n) + Math.pow(Math.abs(Math.sin(angle)), n), -1 / n);

// --- A / 01 — KNOT -----------------------------------------------------------
// A (2,3) torus knot with a cross-section that breathes as it travels, so the
// tube thickens and thins instead of reading as extruded pipe. Its last row
// lands exactly on its first, which closes the loop.
function knot() {
  const P = 2, Q = 3, TUBE = 0.29;

  const path = (t, out) => {
    const u = t * P * TAU;
    const q = (Q / P) * u;
    const r = (2 + Math.cos(q)) / 3;
    out.set(r * Math.cos(u), r * Math.sin(u), Math.sin(q) / 3);
  };

  const here = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();

  return surface((v, theta, out) => {
    path(v, here);
    path(v + 0.001, ahead);
    // Frame the tube off the curve itself rather than a fixed up vector, which
    // would flip wherever the tangent happens to line up with it.
    tangent.subVectors(ahead, here);
    normal.addVectors(ahead, here);
    binormal.crossVectors(tangent, normal).normalize();
    normal.crossVectors(binormal, tangent).normalize();

    const swell = TUBE * (1 + 0.14 * Math.sin(v * TAU * 3));
    out.copy(here)
      .addScaledVector(normal, -Math.cos(theta) * swell)
      .addScaledVector(binormal, Math.sin(theta) * swell);
  });
}

// --- B / 02 — COLUMN ---------------------------------------------------------
// A rounded-square section swept up a waisted profile while turning through
// three quarters of a revolution. Both end rows collapse to a point, which
// closes the surface without needing caps.
function column() {
  const TWIST = Math.PI * 1.5;
  const TIP = 0.05;

  return surface((v, theta, out) => {
    const y = v * 2 - 1;
    const waist = 0.50 * (1 - 0.24 * Math.cos(y * Math.PI));
    const edge = Math.min(1, (1 - Math.abs(y)) / TIP);
    const cap = Math.sqrt(Math.max(0, 1 - (1 - edge) * (1 - edge)));
    // The section is evaluated at a twisted angle but placed at the grid
    // angle — rotating both would cancel out and give a plain lathe.
    const r = waist * cap * superellipse(theta + y * TWIST, 6);
    out.set(Math.cos(theta) * r, y * 1.35, Math.sin(theta) * r);
  });
}

// --- C / 03 — MASS -----------------------------------------------------------
// A sphere pushed around by layered value noise: one slow term for the overall
// mass, one faster term for surface incident.
function hash(i, j, k) {
  // Math.imul throughout: a plain 32-bit-looking multiply in JS silently runs
  // out of float precision and collapses the hash to a constant, which turns
  // the whole sculpture back into a sphere.
  let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return ((n >>> 0) / 4294967295) * 2 - 1;
}

const fade = (t) => t * t * (3 - 2 * t);

function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const mix = (a, b, t) => a + (b - a) * t;
  const face = (dz) => mix(
    mix(hash(xi, yi, zi + dz), hash(xi + 1, yi, zi + dz), xf),
    mix(hash(xi, yi + 1, zi + dz), hash(xi + 1, yi + 1, zi + dz), xf),
    yf
  );
  return mix(face(0), face(1), zf);
}

function fbm(x, y, z, octaves) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise3(x * freq, y * freq, z * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum / norm;
}

function mass() {
  return surface((v, theta, out) => {
    const lat = v * Math.PI;
    const ring = Math.sin(lat);
    const x = ring * Math.cos(theta);
    const y = Math.cos(lat);
    const z = ring * Math.sin(theta);
    const broad = fbm(x * 0.95 + 11, y * 0.95 - 4, z * 0.95 + 7, 2);
    const fine = fbm(x * 2.2 - 31, y * 2.2 + 19, z * 2.2 - 5, 2);
    const r = 1 + broad * 0.34 + fine * 0.055;
    out.set(x * r, y * r, z * r);
  });
}

// --- D / 04 — BAND -----------------------------------------------------------
// A Möbius strip given real thickness: a flat rounded section swept around a
// circle while rotating half a turn, so the surface has a single side. Its last
// row lands on its first rotated by half a ring, which closes it.
function band() {
  // The loop is swept in the ground plane, which would put it edge-on to the
  // camera. Stand it up so the twist is the first thing you see.
  const orient = new THREE.Matrix4()
    .makeRotationY(-0.25)
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI * 0.44));

  return surface((v, theta, out) => {
    const u = v * TAU;
    const twist = u / 2;

    // Frame: outward normal and world up, rotated together by the half twist.
    const ox = Math.cos(u), oz = Math.sin(u);
    const cw = Math.cos(twist), sw = Math.sin(twist);
    const nx = ox * cw, ny = sw, nz = oz * cw;
    const bx = -ox * sw, by = cw, bz = -oz * sw;

    // Flat rounded-rectangle section: wide across the band, thin through it.
    const s = superellipse(theta, 8);
    const across = Math.cos(theta) * s * 0.34;
    const through = Math.sin(theta) * s * 0.045;

    out.set(
      ox + nx * across + bx * through,
      ny * across + by * through,
      oz + nz * across + bz * through
    ).applyMatrix4(orient);
  });
}

export const FORMS = [
  { id: 'A01', name: 'KNOT', note: '(2,3) TORUS', build: knot },
  { id: 'B02', name: 'COLUMN', note: 'SWEPT / TWISTED', build: column },
  { id: 'C03', name: 'MASS', note: 'NOISE DISPLACED', build: mass },
  { id: 'D04', name: 'BAND', note: 'MÖBIUS, SOLID', build: band },
];

const cache = new Map();

export function buildForm(index) {
  let form = cache.get(index);
  if (!form) {
    const position = normalise(FORMS[index].build());
    form = { position, normal: normalsFor(position) };
    cache.set(index, form);
  }
  return form;
}
