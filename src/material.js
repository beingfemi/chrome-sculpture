import * as THREE from 'three';

// Mirror-polished metal, plus a ripple that runs through the surface when the
// sculpture is struck. The ripple is injected into the stock physical shader so
// the material keeps every bit of three's lighting and tone mapping.

export function chromeMaterial() {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 0.035,
    envMapIntensity: 1.25,
  });

  const uniforms = {
    uWaveOrigin: { value: new THREE.Vector3() },
    uWaveAge: { value: -1 },     // seconds since impact; negative means at rest
    uWaveSpeed: { value: 1.75 }, // how fast the ring travels outward
    uWaveLength: { value: 0.26 },
    uWaveWidth: { value: 0.55 }, // thickness of the travelling band
    uWaveAmp: { value: 0.05 },
    uWaveDecay: { value: 1.7 },
    uWaveNormal: { value: 1.3 }, // extra normal bend — this is what you see
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = `
      uniform vec3 uWaveOrigin;
      uniform float uWaveAge, uWaveSpeed, uWaveLength, uWaveWidth, uWaveAmp, uWaveDecay, uWaveNormal;

      // A gaussian ring at radius r, fading out over time.
      float waveEnvelope(float d, float r) {
        float x = (d - r) / uWaveWidth;
        return exp(-x * x) * exp(-uWaveAge * uWaveDecay);
      }
    ` + shader.vertexShader;

    // Bend the normal by the slope of the wave. Displacement alone is nearly
    // invisible on a mirror; the normal is what makes the metal flex.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
      if (uWaveAge >= 0.0) {
        vec3 dir = position - uWaveOrigin;
        float d = length(dir);
        dir = d > 1e-4 ? dir / d : vec3(0.0);
        float r = uWaveAge * uWaveSpeed;
        float k = 6.2831853 / uWaveLength;
        float slope = cos((d - r) * k) * waveEnvelope(d, r) * k * uWaveAmp;
        objectNormal = normalize(objectNormal - dir * slope * uWaveNormal);
      }`
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      if (uWaveAge >= 0.0) {
        float d = distance(position, uWaveOrigin);
        float r = uWaveAge * uWaveSpeed;
        transformed += normal * (sin((d - r) * (6.2831853 / uWaveLength)) * waveEnvelope(d, r) * uWaveAmp);
      }`
    );
  };

  material.userData.uniforms = uniforms;
  return material;
}

export const WAVE_LIFE = 2.0; // seconds before the ripple is switched off
