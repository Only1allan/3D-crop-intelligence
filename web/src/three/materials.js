import * as THREE from 'three'

// Shared wind uniform: every swaying material reads the same clock.
export const wind = { value: 0 }

// Adds a per-instance wind sway (stronger at the top of the plant).
export function swayMaterial(params, strength = 0.09) {
  const m = new THREE.MeshStandardMaterial(params)
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float h = max(0.0, position.y + 0.6);
        float s = sin(uTime * 1.7 + ip.x * 0.33 + ip.z * 0.21) + 0.4 * sin(uTime * 3.1 + ip.x * 0.9);
        transformed.x += s * ${strength.toFixed(3)} * h;
        transformed.z += s * ${(strength * 0.5).toFixed(3)} * h;
      #endif`,
    )
  }
  m.customProgramCacheKey = () => 'sway' + strength
  return m
}
