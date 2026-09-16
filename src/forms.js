import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Four sculptures, all written rather than modelled. Each builder returns a
// geometry normalised to a unit bounding sphere and centred on the origin, so
// the camera never has to move between forms.

const TAU = Math.PI * 2;

function finish(geometry, { weld = true } = {}) {
  const merged = weld ? mergeVertices(geometry, 1e-5) : geometry;
  if (merged !== geometry) geometry.dispose();
  merged.computeBoundingBox();
  const centre = merged.boundingBox.getCenter(new THREE.Vector3());
  merged.translate(-centre.x, -centre.y, -centre.z);
  merged.computeBoundingSphere();
  merged.scale(...Array(3).fill(1 / merged.boundingSphere.radius));
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

// Builds an indexed grid of (rows + 1) x (ring) vertices and stitches it into
// quads. `seamShift` offsets the wrap on the closed ring — a Möbius band needs
// half a ring of offset to meet itself, everything else needs none.
function lathe(rows, ring, position, { closed = false, seamShift = 0 } = {}) {
  const verts = [];
  const index = [];
  const p = new THREE.Vector3();

  for (let i = 0; i <= rows; i++) {
    const v = i / rows;
    for (let j = 0; j < ring; j++) {
      position(v, (j / ring) * TAU, p);
      verts.push(p.x, p.y, p.z);
    }
  }

  for (let i = 0; i < rows; i++) {
    const last = closed && i === rows - 1;
    for (let j = 0; j < ring; j++) {
      const j2 = (j + 1) % ring;
      const a = i * ring + j;
      const b = i * ring + j2;
      // On the closing row we wrap back to row 0, optionally rotated.
      const nextRow = last ? 0 : (i + 1) * ring;
      const shift = last ? seamShift : 0;
      const c = nextRow + (j + shift) % ring;
      const d = nextRow + (j2 + shift) % ring;
      index.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geometry.setIndex(index);
  return geometry;
}

// Radius of a superellipse — n = 2 is a circle, n = 4 a rounded square.
const superellipse = (angle, n) =>
  Math.pow(Math.pow(Math.abs(Math.cos(angle)), n) + Math.pow(Math.abs(Math.sin(angle)), n), -1 / n);

// --- A / 01 — KNOT -----------------------------------------------------------
// A (2,3) torus knot with a cross-section that breathes as it travels, so the
// tube thickens and thins instead of reading as extruded pipe.
function knot() {
  const P = 2, Q = 3, TUBE = 0.29;

  const path = (t, out) => {
    const u = t * P * Math.PI * 2;
    const q = (Q / P) * u;
    const r = (2 + Math.cos(q)) / 3;
    out.set(r * Math.cos(u), r * Math.sin(u), Math.sin(q) / 3);
  };

  const here = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();

  return finish(lathe(560, 48, (v, theta, out) => {
    path(v, here);
    path(v + 0.001, ahead);
    // Frame the tube off the curve itself rather than a fixed up vector, which
    // would flip wherever the tangent happens to line up with it.
    tangent.subVectors(ahead, here);
    normal.addVectors(ahead, here);
    binormal.crossVectors(tangent, normal).normalize();
    normal.crossVectors(binormal, tangent).normalize();

    const swell = TUBE * (1 + 0.14 * Math.sin(v * Math.PI * 2 * 3));
    out.copy(here)
      .addScaledVector(normal, -Math.cos(theta) * swell)
      .addScaledVector(binormal, Math.sin(theta) * swell);
  }, { closed: true }));
}

// --- B / 02 — COLUMN ---------------------------------------------------------
// A rounded-square section swept up a waisted profile while turning through
// three quarters of a revolution. The ends taper to a point, which closes the
// surface without needing caps.
function column() {
  const TWIST = Math.PI * 1.5;
  const TIP = 0.05;

  return finish(lathe(300, 128, (v, theta, out) => {
    const y = v * 2 - 1;
    const waist = 0.50 * (1 - 0.24 * Math.cos(y * Math.PI));
    const edge = Math.min(1, (1 - Math.abs(y)) / TIP);
    const cap = Math.sqrt(Math.max(0, 1 - (1 - edge) * (1 - edge)));
    // The section is evaluated at a twisted angle but placed at the grid
    // angle — rotating both would cancel out and give a plain lathe.
    const r = waist * cap * superellipse(theta + y * TWIST, 6);
    out.set(Math.cos(theta) * r, y * 1.35, Math.sin(theta) * r);
  }));
}

// --- C / 03 — MASS -----------------------------------------------------------
// An icosphere pushed around by layered value noise. No two lobes are alike and
// there are no poles to pinch, which is why it is built from a polyhedron
// rather than a UV sphere.
// Math.imul throughout: a plain 32-bit-looking multiply in JS silently runs out
// of float precision and collapses the hash to a constant, which turns the
// whole sculpture back into a sphere.
function hash(i, j, k) {
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

function fbm(x, y, z, octaves = 4) {
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
  const geometry = mergeVertices(new THREE.IcosahedronGeometry(1, 34), 1e-5);
  const pos = geometry.attributes.position;
  const p = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    // One slow term for overall mass, one faster term for surface incident.
    const broad = fbm(p.x * 0.95 + 11, p.y * 0.95 - 4, p.z * 0.95 + 7, 2);
    const fine = fbm(p.x * 2.2 - 31, p.y * 2.2 + 19, p.z * 2.2 - 5, 2);
    const r = 1 + broad * 0.34 + fine * 0.055;
    pos.setXYZ(i, p.x * r, p.y * r, p.z * r);
  }
  pos.needsUpdate = true;
  return finish(geometry, { weld: false });
}

// --- D / 04 — BAND -----------------------------------------------------------
// A Möbius strip given real thickness: a flat rounded section swept around a
// circle while rotating half a turn, so the surface has a single side. The grid
// meets itself rotated by half a ring, which `seamShift` handles.
function band() {
  const RING = 48;
  const R = 1;

  const geometry = lathe(520, RING, (v, theta, out) => {
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
      ox * R + nx * across + bx * through,
      ny * across + by * through,
      oz * R + nz * across + bz * through
    );
  }, { closed: true, seamShift: RING / 2 });

  // The loop is swept in the ground plane, which puts it edge-on to the camera.
  // Stand it up so the twist is the first thing you see.
  geometry.rotateX(Math.PI * 0.44);
  geometry.rotateY(-0.25);
  return finish(geometry);
}

export const FORMS = [
  { id: 'A01', name: 'KNOT', note: '(2,3) TORUS', build: knot },
  { id: 'B02', name: 'COLUMN', note: 'SWEPT / TWISTED', build: column },
  { id: 'C03', name: 'MASS', note: 'NOISE DISPLACED', build: mass },
  { id: 'D04', name: 'BAND', note: 'MÖBIUS, SOLID', build: band },
];

const cache = new Map();

export function buildForm(index) {
  if (!cache.has(index)) cache.set(index, FORMS[index].build());
  return cache.get(index);
}
