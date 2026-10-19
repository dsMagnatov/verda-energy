import * as THREE from 'three';
import { getSceneControlLimits } from './scene-settings.js';

// Keep the scan's fine fracture normals: a height derivative alone smooths them
// into broad dents. Object-space projection also avoids stretched scan UVs.
export function createDarkRockMaterial(source) {
  const material = source.clone();
  const controls = {
    tint: '#ffffff', scale: .72, normal: 1.08, roughness: .95,
    brightness: 1, contrast: 1, saturation: .45,
    crackColor: '#8f8b80', crackStrength: 0, crackWidth: 1, crackDepth: 1,
    crackGloss: 0, crackMetalness: 0, crackGlow: 0, crackThreshold: .32,
  };
  const limits = getSceneControlLimits('stone');
  // A cloned material serializes userData, so keep the original GPU texture.
  const heightMap = source.userData?.heightMap?.isTexture ? source.userData.heightMap : null;
  const crackMap = heightMap || source.map || source.normalMap || null;
  const crackMapMode = heightMap ? 1 : source.map ? 2 : source.normalMap ? 3 : 0;
  const image = crackMap?.image;
  // Reuse these objects in every compiled variant so dragging a control only
  // changes uniform values, including when controls are set before compilation.
  const uniforms = {
    uStoneScale: { value: controls.scale },
    uStoneBrightness: { value: controls.brightness },
    uStoneContrast: { value: controls.contrast },
    uStoneSaturation: { value: controls.saturation },
    uCrackHeightMap: { value: crackMap },
    uCrackMapMode: { value: crackMapMode },
    uCrackTexel: { value: new THREE.Vector2(1 / (image?.width || 2048), 1 / (image?.height || 2048)) },
    uCrackColor: { value: new THREE.Color(controls.crackColor) },
    uCrackStrength: { value: controls.crackStrength },
    uCrackWidth: { value: controls.crackWidth },
    uCrackDepth: { value: controls.crackDepth },
    uCrackGloss: { value: controls.crackGloss },
    uCrackMetalness: { value: controls.crackMetalness },
    uCrackGlow: { value: controls.crackGlow },
    uCrackThreshold: { value: controls.crackThreshold },
  };
  const baseTint = new THREE.Color().setRGB(1.03, 1.04, 1.04);
  material.name = 'Bare Dark Rock — triplanar fracture normals';
  material.normalMap = source.normalMap;
  material.normalMapType = THREE.TangentSpaceNormalMap;
  material.normalScale.set(1.08, 1.08);
  material.roughnessMap = source.roughnessMap;
  material.roughness = controls.roughness;
  material.metalness = 0;
  material.bumpMap = null;
  material.color.copy(baseTint);

  material.setControls = (params = {}) => {
    if (params !== null && typeof params === 'object') {
      for (const key of ['tint', 'crackColor']) {
        if (typeof params[key] === 'string' && /^#[0-9a-f]{6}$/i.test(params[key])) controls[key] = params[key];
      }
      for (const [key, [min, max]] of Object.entries(limits)) {
        if (typeof params[key] === 'number' && Number.isFinite(params[key])) {
          controls[key] = THREE.MathUtils.clamp(params[key], min, max);
        }
      }
    }
    material.color.set(controls.tint).multiply(baseTint);
    material.normalScale.setScalar(controls.normal);
    material.roughness = controls.roughness;
    uniforms.uStoneScale.value = controls.scale;
    uniforms.uStoneBrightness.value = controls.brightness;
    uniforms.uStoneContrast.value = controls.contrast;
    uniforms.uStoneSaturation.value = controls.saturation;
    uniforms.uCrackColor.value.set(controls.crackColor);
    for (const key of ['Strength', 'Width', 'Depth', 'Gloss', 'Metalness', 'Glow', 'Threshold']) {
      uniforms[`uCrack${key}`].value = controls[`crack${key}`];
    }
    return material;
  };

  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vStonePosition;
        varying vec3 vStoneNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vStonePosition = position;
        vStoneNormal = normal;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vStonePosition;
        varying vec3 vStoneNormal;
        uniform float uStoneScale;
        uniform float uStoneBrightness;
        uniform float uStoneContrast;
        uniform float uStoneSaturation;
        uniform sampler2D uCrackHeightMap;
        uniform float uCrackMapMode;
        uniform vec2 uCrackTexel;
        uniform vec3 uCrackColor;
        uniform float uCrackStrength;
        uniform float uCrackWidth;
        uniform float uCrackDepth;
        uniform float uCrackGloss;
        uniform float uCrackMetalness;
        uniform float uCrackGlow;
        uniform float uCrackThreshold;

        vec3 stoneProjectionWeights() {
          vec3 weights = pow(abs(normalize(vStoneNormal)), vec3(7.0));
          return weights / max(dot(weights, vec3(1.0)), 0.0001);
        }

        vec4 stoneTriplanar(sampler2D stoneMap) {
          vec3 weights = stoneProjectionWeights();
          vec3 p = vStonePosition * uStoneScale;
          return texture2D(stoneMap, p.yz) * weights.x
            + texture2D(stoneMap, p.xz) * weights.y
            + texture2D(stoneMap, p.xy) * weights.z;
        }

        float stoneCrackHeight(vec2 uv) {
          vec3 sampleValue = texture2D(uCrackHeightMap, uv).rgb;
          if (uCrackMapMode < 1.5) return sampleValue.r;
          if (uCrackMapMode < 2.5) return dot(sampleValue, vec3(0.2126, 0.7152, 0.0722));
          return sampleValue.b;
        }

        float stoneCrackProjection(vec2 uv) {
          vec2 radius = uCrackTexel * max(0.75, uCrackWidth * 3.0);
          float center = stoneCrackHeight(uv);
          float left = stoneCrackHeight(uv - vec2(radius.x, 0.0));
          float right = stoneCrackHeight(uv + vec2(radius.x, 0.0));
          float down = stoneCrackHeight(uv - vec2(0.0, radius.y));
          float up = stoneCrackHeight(uv + vec2(0.0, radius.y));
          // Local concavity selects thin scan crevices rather than filling
          // every low, dark face of the rock. No generated noise is involved.
          float valley = max((left + right + down + up) * 0.25 - center, 0.0) * 16.0;
          float heightGate = 1.0 - smoothstep(uCrackThreshold, min(1.0, uCrackThreshold + 0.18), center);
          float feature = valley * heightGate;
          float boundary = 0.045 / max(uCrackWidth, 0.2);
          float aa = max(fwidth(feature), 0.008);
          return smoothstep(boundary - aa, boundary + aa, feature);
        }

        float stoneCrackMask() {
          if (uCrackMapMode < 0.5 || uCrackStrength <= 0.0) return 0.0;
          vec3 p = vStonePosition * uStoneScale;
          vec3 weights = stoneProjectionWeights();
          float mask = stoneCrackProjection(p.yz) * weights.x
            + stoneCrackProjection(p.xz) * weights.y
            + stoneCrackProjection(p.xy) * weights.z;
          return clamp(mask * uCrackStrength, 0.0, 1.0);
        }

        // A frame for each projection, independent of the mesh's UV tangents.
        // Keeping this helper local also supports scans with TANGENT attributes.
        mat3 stoneTangentFrame(vec3 eyePosition, vec3 surfaceNormal, vec2 uv) {
          vec3 dpdx = dFdx(eyePosition);
          vec3 dpdy = dFdy(eyePosition);
          vec2 duvdx = dFdx(uv);
          vec2 duvdy = dFdy(uv);
          vec3 dyPerpendicular = cross(dpdy, surfaceNormal);
          vec3 dxPerpendicular = cross(surfaceNormal, dpdx);
          vec3 tangent = dyPerpendicular * duvdx.x + dxPerpendicular * duvdy.x;
          vec3 bitangent = dyPerpendicular * duvdx.y + dxPerpendicular * duvdy.y;
          float inverseLength = inversesqrt(max(max(dot(tangent, tangent), dot(bitangent, bitangent)), 1e-16));
          return mat3(tangent * inverseLength, bitangent * inverseLength, surfaceNormal);
        }

        vec3 stoneFractureNormal(sampler2D stoneMap, vec2 uv, vec2 strength) {
          vec3 scanNormal = texture2D(stoneMap, uv).xyz * 2.0 - 1.0;
          vec3 fineNormal = texture2D(stoneMap, uv * 3.71 + vec2(0.173, 0.419)).xyz * 2.0 - 1.0;
          scanNormal.xy = (scanNormal.xy + fineNormal.xy * 0.16) * strength;
          return normalize(scanNormal);
        }`)
      .replace('#include <map_fragment>', `float stoneCrackAmount = stoneCrackMask();
      #ifdef USE_MAP
        vec4 stoneAlbedo = stoneTriplanar(map);
        float stoneLuminance = dot(stoneAlbedo.rgb, vec3(0.2126, 0.7152, 0.0722));
        stoneAlbedo.rgb = mix(vec3(stoneLuminance), stoneAlbedo.rgb, uStoneSaturation);
        stoneAlbedo.rgb = clamp((stoneAlbedo.rgb - vec3(0.18)) * uStoneContrast + vec3(0.18), 0.0, 1.0);
        stoneAlbedo.rgb = clamp(stoneAlbedo.rgb * uStoneBrightness, 0.0, 1.0);
        diffuseColor *= stoneAlbedo;
      #endif
      diffuseColor.rgb = max(mix(diffuseColor.rgb, uCrackColor * uStoneBrightness, stoneCrackAmount), vec3(0.0));`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = clamp(roughness, 0.035, 1.0);
      #ifdef USE_ROUGHNESSMAP
        // Dry stone stays rough even in the dark parts of the scan's map.
        roughnessFactor *= mix(0.86, 1.0, stoneTriplanar(roughnessMap).g);
      #endif
      roughnessFactor = clamp(roughnessFactor / (1.0 + uCrackGloss * 5.0 * stoneCrackAmount), 0.035, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = clamp(metalnessFactor + uCrackMetalness * stoneCrackAmount, 0.0, 1.0);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uCrackColor * uCrackGlow * stoneCrackAmount;`)
      .replace('#include <normal_fragment_maps>', `#ifdef USE_NORMALMAP_TANGENTSPACE
        vec3 stoneP = vStonePosition * uStoneScale;
        vec3 stoneWeights = stoneProjectionWeights();
        vec3 stoneBaseNormal = normal;
        mat3 stoneFrameX = stoneTangentFrame(-vViewPosition, stoneBaseNormal, stoneP.yz);
        mat3 stoneFrameY = stoneTangentFrame(-vViewPosition, stoneBaseNormal, stoneP.xz);
        mat3 stoneFrameZ = stoneTangentFrame(-vViewPosition, stoneBaseNormal, stoneP.xy);
        #if defined(DOUBLE_SIDED) && !defined(FLAT_SHADED)
          stoneFrameX[0] *= faceDirection;
          stoneFrameX[1] *= faceDirection;
          stoneFrameY[0] *= faceDirection;
          stoneFrameY[1] *= faceDirection;
          stoneFrameZ[0] *= faceDirection;
          stoneFrameZ[1] *= faceDirection;
        #endif
        vec2 stoneNormalStrength = normalScale * (1.0 + stoneCrackAmount * (uCrackDepth - 1.0));
        vec3 stoneNormalX = normalize(stoneFrameX * stoneFractureNormal(normalMap, stoneP.yz, stoneNormalStrength));
        vec3 stoneNormalY = normalize(stoneFrameY * stoneFractureNormal(normalMap, stoneP.xz, stoneNormalStrength));
        vec3 stoneNormalZ = normalize(stoneFrameZ * stoneFractureNormal(normalMap, stoneP.xy, stoneNormalStrength));
        normal = normalize(stoneNormalX * stoneWeights.x + stoneNormalY * stoneWeights.y + stoneNormalZ * stoneWeights.z);
      #endif`);
  };
  material.customProgramCacheKey = () => 'verda-dark-rock-triplanar-fracture-layers-v4';
  return material;
}
