import * as THREE from 'three';
import { studioEnvironment } from './env.js';
import { FORMS, buildForm, gridIndex } from './forms.js';
import { chromeMaterial, WAVE_LIFE } from './material.js';

const canvas = document.getElementById('scene');
const veil = document.getElementById('veil');
const overture = document.getElementById('overture');
const picker = document.getElementById('picker');
const clockEl = document.getElementById('clock');
const formId = document.getElementById('formId');
const formName = document.getElementById('formName');
const formNote = document.getElementById('formNote');

const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isNarrow = () => window.innerWidth <= 720;

// --- Renderer, scene, camera -------------------------------------------------

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.environment = studioEnvironment(renderer);

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
camera.position.set(0, 0, 5.6);

const rig = new THREE.Group();
scene.add(rig);

const material = chromeMaterial();
const wave = material.userData.uniforms;

// One mesh for all four sculptures. The index buffer is shared and never
// changes; only the position and normal arrays are rewritten, which is what
// lets one form flow into the next.
let current = 0;
const geometry = new THREE.BufferGeometry();
geometry.setIndex(new THREE.BufferAttribute(gridIndex(), 1));

const first = buildForm(current);
const positions = new THREE.BufferAttribute(new Float32Array(first.position), 3);
const normals = new THREE.BufferAttribute(new Float32Array(first.normal), 3);
positions.setUsage(THREE.DynamicDrawUsage);
normals.setUsage(THREE.DynamicDrawUsage);
geometry.setAttribute('position', positions);
geometry.setAttribute('normal', normals);

// Every form is normalised to a unit sphere at the origin, and a blend of two
// such forms stays inside it, so this bound holds through the whole morph and
// never needs recomputing — raycasting keeps working mid-flight.
geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);

const sculpture = new THREE.Mesh(geometry, material);
rig.add(sculpture);

// Enough of a key light to put a crisp edge on the silhouette; at roughness
// 0.035 the environment is doing nearly all of the work.
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(2, 3, 4);
scene.add(key);

// --- Layout ------------------------------------------------------------------

// Fit the unit-radius sculpture inside whichever viewport dimension is tighter.
function fit() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  const halfW = halfH * camera.aspect;
  baseScale = Math.min(halfH, halfW) * (isNarrow() ? 0.68 : 0.58);
}

let baseScale = 1;
fit();
addEventListener('resize', fit);

// --- Morphing ----------------------------------------------------------------

// The morph carries the change of form entirely on its own: no ripple, no
// flash, just one shape flowing into the next.
const MORPH_TIME = 1.2;

let morphFrom = 0;
let morphTo = 0;
let morphAge = -1;

function blend(from, to, t) {
  const a = buildForm(from);
  const b = buildForm(to);
  const pos = positions.array, nrm = normals.array;
  const ap = a.position, bp = b.position, an = a.normal, bn = b.normal;

  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = ap[i] + (bp[i] - ap[i]) * t;
    pos[i + 1] = ap[i + 1] + (bp[i + 1] - ap[i + 1]) * t;
    pos[i + 2] = ap[i + 2] + (bp[i + 2] - ap[i + 2]) * t;

    // Lerping the two forms' normals is far cheaper than recomputing them every
    // frame, and over a 1.2s flight nobody can tell. The exact normals are put
    // back when the morph settles.
    let nx = an[i] + (bn[i] - an[i]) * t;
    let ny = an[i + 1] + (bn[i + 1] - an[i + 1]) * t;
    let nz = an[i + 2] + (bn[i + 2] - an[i + 2]) * t;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-6) {
      nx /= len; ny /= len; nz /= len;
    } else {
      nx = bn[i]; ny = bn[i + 1]; nz = bn[i + 2];
    }
    nrm[i] = nx; nrm[i + 1] = ny; nrm[i + 2] = nz;
  }

  positions.needsUpdate = true;
  normals.needsUpdate = true;
}

function settle(index) {
  const form = buildForm(index);
  positions.array.set(form.position);
  normals.array.set(form.normal);
  positions.needsUpdate = true;
  normals.needsUpdate = true;
}

// --- Interaction state -------------------------------------------------------

// Wide enough that the sculpture visibly turns to face wherever the cursor is,
// rather than drifting: about 70 degrees of yaw across the window.
const PARALLAX = { x: 1.22, y: 0.68 };
const SPIN_TIME = 1.15;
const INTRO_TIME = 1.4;

let aimX = 0, aimY = 0;   // where the pointer wants the sculpture to face
let turnX = 0, turnY = 0; // where it actually is, chasing the aim
let spinAge = -1, spinDir = 1;
let introAge = -1;  // starts counting when the loader clears
let ready = false;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

addEventListener('pointermove', (e) => {
  if (isNarrow()) return;
  aimX = (e.clientX / innerWidth * 2 - 1) * PARALLAX.x;
  aimY = (e.clientY / innerHeight * 2 - 1) * PARALLAX.y;
});

function strike(localPoint) {
  wave.uWaveOrigin.value.copy(localPoint);
  wave.uWaveAge.value = 0;
}

function spin(direction) {
  if (spinAge >= 0) return;
  spinAge = 0;
  spinDir = direction;
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

// Hitting the metal sends a ripple out from the point of contact; missing it
// flicks the whole sculpture around instead.
canvas.addEventListener('pointerdown', (e) => {
  if (!ready || morphAge >= 0) return;
  const rect = canvas.getBoundingClientRect();
  ndc.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(sculpture, false)[0];
  if (hit) strike(sculpture.worldToLocal(hit.point.clone()));
  else spin(ndc.x >= 0 ? 1 : -1);
});

// --- Form picker -------------------------------------------------------------

// The set of forms as figures, the current one boxed — their index. The name
// and note for whichever is current sit in the row beneath it, so nothing is
// lost by reducing the buttons to numbers.
const figures = FORMS.map((form, i) => {
  const button = document.createElement('button');
  button.className = 'num';
  button.type = 'button';
  button.textContent = String(i + 1);
  button.setAttribute('aria-label', `${form.id} ${form.name}, ${form.note}`);
  // pointerdown so it responds the instant you press; click as well so that
  // keyboard activation (Enter on a focused button) works too. select() ignores
  // the second call because the form is already current by then.
  button.addEventListener('pointerdown', () => select(i));
  button.addEventListener('click', () => select(i));
  picker.append(button);
  return button;
});

function markPicker() {
  figures.forEach((button, i) => button.setAttribute('aria-current', String(i === current)));
  const form = FORMS[current];
  formId.textContent = form.id;
  formName.textContent = form.name;
  formNote.textContent = form.note;
}
markPicker();

function select(index) {
  if (index === current || morphAge >= 0 || !ready) return;
  morphFrom = current;
  morphTo = index;
  morphAge = 0;
  current = index;
  markPicker();
}

addEventListener('keydown', (e) => {
  const n = Number(e.key);
  if (n >= 1 && n <= FORMS.length) select(n - 1);
  else if (e.key === 'ArrowRight') select((current + 1) % FORMS.length);
  else if (e.key === 'ArrowLeft') select((current - 1 + FORMS.length) % FORMS.length);
  else if (e.key.toLowerCase() === 'r') strike(new THREE.Vector3());
});

// --- Clock -------------------------------------------------------------------

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'LOCAL';
const place = zone.split('/').pop().replace(/_/g, ' ');
const tick = () => { clockEl.textContent = `${new Date().toLocaleTimeString('en-GB')}, ${place}`; };
setInterval(tick, 1000);
tick();

// --- Frame -------------------------------------------------------------------

// The loader, matching Unstated's timing: a beat of empty ground, then every
// word fades up over a slow two seconds, each starting 80ms after the last.
// Because the fade is so much longer than the stagger, all of the words are in
// flight at once and the sentence surfaces as a whole with a lean to the left —
// not a light travelling word by word, which is a much busier effect.
//
// It runs on CSS transitions and timers rather than the render loop:
// requestAnimationFrame is paused in a background tab, so tying the reveal to
// it would leave a page opened in the background stuck behind the loader.
const LEAD_IN = calm ? 200 : 1000;   // blank ground before anything surfaces
const STAGGER = calm ? 20 : 80;      // between one word starting and the next
const FADE = calm ? 300 : 2000;      // how long a single word takes to arrive
const HOLD = 500;                    // beat at the end, with the sentence whole

function playOverture() {
  let index = 0;
  overture.querySelectorAll('p').forEach((line) => {
    const words = line.textContent.trim().split(/\s+/);
    line.textContent = '';
    words.forEach((word, i) => {
      const span = document.createElement('span');
      span.className = 'loader-word';
      span.textContent = word;
      span.style.transitionDelay = `${index * STAGGER}ms`;
      line.append(span);
      if (i < words.length - 1) line.append(' ');
      index++;
    });
  });

  setTimeout(() => veil.classList.add('lit'), LEAD_IN);
  setTimeout(reveal, LEAD_IN + (index - 1) * STAGGER + FADE + HOLD);
}

function reveal() {
  if (ready) return;
  ready = true;
  introAge = 0;  // the sculpture rolls up as the sheet goes
  veil.classList.add('gone');
  veil.style.opacity = '0';
  setTimeout(() => { veil.style.display = 'none'; }, 560);
  prewarm();
}

// Clicking anywhere on the sheet skips the wait, as it does on Unstated.
veil.addEventListener('pointerdown', reveal);

playOverture();
setTimeout(reveal, 9000);  // backstop, in case the sequence above never lands

const clock = new THREE.Clock();
let elapsed = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  // Chase the pointer, frame-rate independent.
  if (ready) {
    const chase = 1 - Math.pow(1 - 0.13, dt * 60);
    turnX += (aimY - turnX) * chase;
    turnY += (aimX - turnY) * chase;
  }

  // Intro: the sculpture rolls up out of a tilt once the loader has cleared.
  let intro = 0;
  if (introAge >= 0) {
    introAge += dt;
    intro = easeOutCubic(Math.min(introAge / INTRO_TIME, 1));
  }

  // A full revolution, eased at both ends.
  let spinAngle = 0;
  if (spinAge >= 0) {
    spinAge += dt;
    const t = Math.min(spinAge / SPIN_TIME, 1);
    spinAngle = spinDir * Math.PI * 2 * easeInOutCubic(t);
    if (t >= 1) spinAge = -1;
  }

  // One form flowing into the next, with a slow turn and the faintest dip so
  // the change reads as a movement rather than a substitution.
  let morphTurn = 0;
  let morphDip = 0;
  if (morphAge >= 0) {
    morphAge += dt;
    const t = Math.min(morphAge / MORPH_TIME, 1);
    if (t >= 1) {
      settle(morphTo);
      morphAge = -1;
    } else {
      blend(morphFrom, morphTo, easeInOutCubic(t));
    }
    const arc = Math.sin(Math.PI * t);
    morphTurn = arc * 0.45;
    morphDip = arc * 0.03;
  }

  // The ripple, and the small recoil that goes with it.
  let recoil = 0;
  if (wave.uWaveAge.value >= 0) {
    wave.uWaveAge.value += dt;
    const age = wave.uWaveAge.value;
    recoil = age < 0.5
      ? (1 - Math.cos((age / 0.5) * Math.PI)) / 2
      : Math.max(0, 1 - (age - 0.5) / 0.45);
    if (age > WAVE_LIFE) wave.uWaveAge.value = -1;
  }

  rig.rotation.y = turnY + spinAngle + morphTurn;
  rig.rotation.x = turnX - (1 - intro) * 0.55;
  rig.position.y = calm ? 0 : Math.sin(elapsed * 0.85) * 0.045;
  rig.scale.setScalar(baseScale * (0.9 + 0.1 * intro) * (1 - 0.05 * recoil) * (1 - morphDip));

  if (!calm) scene.environmentRotation.y += 0.045 * dt;

  renderer.render(scene, camera);
}

// Build the forms we are not showing yet while the machine is idle, so the
// first morph into each one is instant.
function prewarm() {
  const soon = (fn) => (window.requestIdleCallback
    ? requestIdleCallback(fn, { timeout: 400 })
    : setTimeout(fn, 32));
  const queue = FORMS.map((_, i) => i).filter((i) => i !== current);
  const next = () => {
    const i = queue.shift();
    if (i === undefined) return;
    buildForm(i);
    soon(next);
  };
  soon(next);
}

frame();
