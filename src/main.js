import * as THREE from 'three';
import { studioEnvironment } from './env.js';
import { FORMS, buildForm } from './forms.js';
import { chromeMaterial, WAVE_LIFE } from './material.js';

const canvas = document.getElementById('scene');
const veil = document.getElementById('veil');
const picker = document.getElementById('picker');
const clockEl = document.getElementById('clock');

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

let current = 0;
const sculpture = new THREE.Mesh(buildForm(current), material);
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
  baseScale = Math.min(halfH, halfW) * (isNarrow() ? 0.84 : 0.78);
}

let baseScale = 1;
fit();
addEventListener('resize', fit);

// --- Interaction state -------------------------------------------------------

const PARALLAX = { x: 0.62, y: 0.40 };
const SPIN_TIME = 1.15;
const SWAP_OUT = 0.26;
const SWAP_IN = 0.52;
const INTRO_TIME = 1.4;

let aimX = 0, aimY = 0;   // where the pointer wants the sculpture to face
let turnX = 0, turnY = 0; // where it actually is, chasing the aim
let spinAge = -1, spinDir = 1;
let swapAge = -1, swapTo = 0;
let introAge = 0;
let ready = false;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInCubic = (t) => t * t * t;

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
  if (!ready || swapAge >= 0) return;
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

const chips = FORMS.map((form, i) => {
  const chip = document.createElement('button');
  chip.className = 'chip';
  chip.type = 'button';
  chip.innerHTML = `<b>${form.id} ${form.name}</b><i>${form.note}</i>`;
  // pointerdown so it responds the instant you press; click as well so that
  // keyboard activation (Enter on a focused chip) works too. select() ignores
  // the second call because the form is already current by then.
  chip.addEventListener('pointerdown', () => select(i));
  chip.addEventListener('click', () => select(i));
  picker.append(chip);
  return chip;
});

function markPicker() {
  chips.forEach((chip, i) => chip.setAttribute('aria-current', String(i === current)));
}
markPicker();

function select(index) {
  if (index === current || swapAge >= 0 || !ready) return;
  swapTo = index;
  swapAge = 0;
  current = index;
  markPicker();
}

addEventListener('keydown', (e) => {
  const n = Number(e.key);
  if (n >= 1 && n <= FORMS.length) select(n - 1);
  else if (e.key === 'ArrowRight') select((current + 1) % FORMS.length);
  else if (e.key === 'ArrowLeft') select((current - 1 + FORMS.length) % FORMS.length);
  else if (e.key.toLowerCase() === 'r') strike(new THREE.Vector3(0, 0, 0));
});

// --- Clock -------------------------------------------------------------------

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'LOCAL';
const place = zone.split('/').pop().replace(/_/g, ' ');
setInterval(() => {
  clockEl.textContent = `${new Date().toLocaleTimeString('en-GB')}, ${place}`;
}, 1000);
clockEl.textContent = `${new Date().toLocaleTimeString('en-GB')}, ${place}`;

// --- Frame -------------------------------------------------------------------

// Clearing the veil is deliberately not tied to the render loop alone:
// requestAnimationFrame is paused in a background tab, so a page opened in the
// background would otherwise sit on "CASTING" until someone focused it.
function reveal() {
  if (ready) return;
  ready = true;
  veil.style.opacity = '0';
  setTimeout(() => { veil.style.display = 'none'; }, 520);
  prewarm();
}
setTimeout(reveal, 1500);

const clock = new THREE.Clock();
let elapsed = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  // Chase the pointer, frame-rate independent.
  if (ready) {
    const chase = 1 - Math.pow(1 - 0.075, dt * 60);
    turnX += (aimY - turnX) * chase;
    turnY += (aimX - turnY) * chase;
  }

  // Intro: the sculpture rolls up out of a tilt as the veil clears.
  let intro = 1;
  if (introAge < INTRO_TIME) {
    introAge += dt;
    intro = easeOutCubic(Math.min(introAge / INTRO_TIME, 1));
    if (introAge > 0.1) reveal();
  }

  // A full revolution, eased at both ends.
  let spinAngle = 0;
  if (spinAge >= 0) {
    spinAge += dt;
    const t = Math.min(spinAge / SPIN_TIME, 1);
    spinAngle = spinDir * Math.PI * 2 * easeInOutCubic(t);
    if (t >= 1) spinAge = -1;
  }

  // Swapping forms: shrink away, exchange the geometry, grow back with a
  // shockwave rolling out from the centre.
  let swapScale = 1;
  let swapTurn = 0;
  if (swapAge >= 0) {
    swapAge += dt;
    if (swapAge < SWAP_OUT) {
      const t = swapAge / SWAP_OUT;
      swapScale = 1 - 0.92 * easeInCubic(t);
      swapTurn = t * 0.7;
    } else {
      if (sculpture.geometry !== buildForm(swapTo)) {
        sculpture.geometry = buildForm(swapTo);
        strike(new THREE.Vector3(0, 0, 0));
      }
      const t = Math.min((swapAge - SWAP_OUT) / SWAP_IN, 1);
      swapScale = 0.08 + 0.92 * easeOutCubic(t);
      swapTurn = 0.7 - 0.7 * easeOutCubic(t);
      if (t >= 1) swapAge = -1;
    }
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

  rig.rotation.y = turnY + spinAngle + swapTurn;
  rig.rotation.x = turnX - (1 - intro) * 0.55;
  rig.position.y = calm ? 0 : Math.sin(elapsed * 0.85) * 0.045;
  rig.scale.setScalar(baseScale * swapScale * (0.9 + 0.1 * intro) * (1 - 0.05 * recoil));

  if (!calm) scene.environmentRotation.y += 0.045 * dt;

  renderer.render(scene, camera);
}

// Build the forms we are not showing yet while the machine is idle, so the
// first switch to each one is instant.
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
