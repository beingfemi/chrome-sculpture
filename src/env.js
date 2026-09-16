import * as THREE from 'three';

// A polished metal has no colour of its own — it only shows you the room it is
// standing in. So before anything else we have to build a room. This paints a
// fake photographic studio onto an equirectangular canvas: a bright ceiling, a
// dark floor, a hard horizon, hard-edged softboxes and black flags between
// them. PMREM then turns it into the prefiltered cubemap the material samples.
//
// The hard edges matter. Soft gradients alone give you soap, not chrome — the
// metal needs something with a border in it before it can look like metal.

// Deterministic PRNG, so the studio is identical on every load and every device.
function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function studioEnvironment(renderer, { width = 2048, height = 1024, seed = 0x5c17e3 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const rand = seeded(seed);

  // Everything is drawn three times — once shifted a full width left and once
  // right — so shapes crossing the seam wrap instead of getting clipped.
  const wrapped = (draw) => {
    for (const shift of [-width, 0, width]) {
      ctx.save();
      ctx.translate(shift, 0);
      draw();
      ctx.restore();
    }
  };

  const panel = (x, y, w, h, fill, blur = 0) => wrapped(() => {
    ctx.filter = blur ? `blur(${blur}px)` : 'none';
    ctx.fillStyle = fill;
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
  });

  const glow = (x, y, radius, level, alpha) => wrapped(() => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(${level},${level},${level},${alpha})`);
    g.addColorStop(0.5, `rgba(${level},${level},${level},${alpha * 0.4})`);
    g.addColorStop(1, `rgba(${level},${level},${level},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  });

  // Ceiling falling to floor, with a hard horizon. That horizon is what gives
  // chrome its signature waistline.
  const room = ctx.createLinearGradient(0, 0, 0, height);
  room.addColorStop(0.00, '#f2f2f2');
  room.addColorStop(0.34, '#b4b4b4');
  room.addColorStop(0.485, '#8a8a8a');
  room.addColorStop(0.50, '#1e1e1e');
  room.addColorStop(0.70, '#3a3a3a');
  room.addColorStop(1.00, '#0a0a0a');
  ctx.fillStyle = room;
  ctx.fillRect(0, 0, width, height);

  // Black flags first, so the lights read as cut-outs against them.
  for (let i = 0; i < 6; i++) {
    panel(rand() * width, height * (0.06 + rand() * 0.34),
      width * (0.05 + rand() * 0.09), height * (0.18 + rand() * 0.30), '#000', 3);
  }

  // Softboxes: crisp white rectangles in the upper half. These are the shapes
  // that sweep across the form as it turns.
  const boxes = [
    [0.13, 0.20, 0.13, 0.30],
    [0.41, 0.13, 0.09, 0.19],
    [0.63, 0.26, 0.16, 0.16],
    [0.86, 0.17, 0.07, 0.26],
  ];
  for (const [fx, fy, fw, fh] of boxes) {
    panel(fx * width, fy * height, fw * width, fh * height, '#fff', 2);
    panel(fx * width, fy * height, fw * width * 1.5, fh * height * 1.5, 'rgba(255,255,255,0.22)', 40);
  }

  // Two strip lights running along the ceiling.
  for (let i = 0; i < 2; i++) {
    const y = height * (0.05 + i * 0.075);
    panel(rand() * width, y, width * (0.30 + rand() * 0.2), height * 0.022, '#fff', 2);
  }

  // A pool of bounced light on the floor, just below the horizon.
  panel(width * 0.5, height * 0.545, width * 0.55, height * 0.05, 'rgba(210,210,210,0.55)', 26);

  // Bounce cards: a shuffled brightness ramp so the room holds a full range of
  // tones rather than a handful of repeated greys.
  const CARDS = 18;
  const ramp = Array.from({ length: CARDS }, (_, i) => Math.round(255 * Math.pow(i / (CARDS - 1), 1.0)));
  for (let i = CARDS - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ramp[i], ramp[j]] = [ramp[j], ramp[i]];
  }
  for (let i = 0; i < CARDS; i++) {
    glow(rand() * width, rand() * height, (0.06 + rand() * 0.14) * width, ramp[i], 0.3 + rand() * 0.3);
  }

  // Small hot specular points — the pinpoint sparkles.
  for (let i = 0; i < 16; i++) {
    panel(rand() * width, rand() * height * 0.46, width * 0.006, width * 0.006, '#fff', 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromEquirectangular(texture);

  texture.dispose();
  pmrem.dispose();

  return target.texture;
}
