import {
  GRASS_DEPTH_CURVE,
  GRASS_SEGMENTS,
  HEIGHT_MIN,
  HEIGHT_RANGE,
  TERRAIN_FAR,
  TERRAIN_NEAR,
  TERRAIN_SLOPE,
  TERRAIN_WIDTH,
} from "./layout";
import { MOB_CONTACTS } from "./mobs";

const linear = (hex: string) => {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => ((c / 255) ** 2.2).toFixed(4));
};
const rgb = (hex: string) => `vec3(${linear(hex).join(", ")})`;
const float = (value: number) => (Number.isInteger(value) ? `${value}.0` : `${value}`);


const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

const COMMON = `
uniform vec3 uSunDir;
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform float uKeyElev;
uniform vec4 uShadowMix;
uniform vec3 uMoonDir;
uniform vec3 uCamPos;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyLow;
uniform vec3 uSkyMid;
uniform vec3 uSkyTop;
uniform vec3 uGlow;
uniform float uSkySpan;
uniform float uAmbient;
uniform float uHaze;
uniform float uMist;
uniform float uNight;
uniform float uTime;
uniform vec4 uVeil;
uniform vec2 uVeilFeather;
uniform vec2 uTargetSize;

const float PI = 3.14159265;
const float TZN = ${float(TERRAIN_NEAR)};
const float TZF = ${float(TERRAIN_FAR)};
const float TW0 = ${float(TERRAIN_WIDTH)};
const float TSLOPE = ${float(TERRAIN_SLOPE)};
const float HMIN = ${float(HEIGHT_MIN)};
const float HRANGE = ${float(HEIGHT_RANGE)};
const mat2 OCTAVE_TURN = mat2(0.8, -0.6, 0.6, 0.8);

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 x) {
  vec2 cell = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(cell);
  float b = hash12(cell + vec2(1.0, 0.0));
  float c = hash12(cell + vec2(0.0, 1.0));
  float d = hash12(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

float fbm(vec2 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < octaves; i++) {
    sum += amp * valueNoise(p);
    p = OCTAVE_TURN * p * 2.03 + vec2(4.1, 1.7);
    amp *= 0.5;
  }
  return sum;
}

vec2 terrainWorld(vec2 uv) {
  float z = TZN * pow(TZF / TZN, uv.y);
  return vec2((uv.x * 2.0 - 1.0) * (TW0 + z * TSLOPE), z);
}

vec2 terrainUv(vec2 p) {
  float z = max(p.y, TZN);
  return vec2(p.x / (TW0 + z * TSLOPE) * 0.5 + 0.5, log(z / TZN) / log(TZF / TZN));
}

float decodeHeight(vec4 texel) {
  return (texel.r * 65280.0 + texel.g * 255.0) / 65535.0 * HRANGE + HMIN;
}

vec2 decodeGradient(vec2 encoded) {
  vec2 e = encoded * 2.0 - 1.0;
  return e / max(1.0 - abs(e), 0.004);
}

float meadowHeight(vec2 p) {
  float near = 0.16 * valueNoise(p * 0.09) + 0.07 * valueNoise(p * 0.33 + 7.0);
  float far = smoothstep(30.0, 360.0, p.y);
  return near + far * (6.0 + 8.0 * valueNoise(p * 0.004 + 3.0) + 2.5 * valueNoise(p * 0.018 + 1.3));
}

float bakedHeight(sampler2D heightTex, vec2 uv) {
  ivec2 size = textureSize(heightTex, 0);
  vec2 st = uv * vec2(size) - 0.5;
  ivec2 base = ivec2(floor(st));
  vec2 f = fract(st);
  ivec2 top = size - 1;
  float a = decodeHeight(texelFetch(heightTex, clamp(base, ivec2(0), top), 0));
  float b = decodeHeight(texelFetch(heightTex, clamp(base + ivec2(1, 0), ivec2(0), top), 0));
  float c = decodeHeight(texelFetch(heightTex, clamp(base + ivec2(0, 1), ivec2(0), top), 0));
  float d = decodeHeight(texelFetch(heightTex, clamp(base + ivec2(1, 1), ivec2(0), top), 0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 skyGradient(float h) {
  vec3 col = mix(uSkyHorizon, uSkyLow, smoothstep(0.0, 0.16, h));
  col = mix(col, uSkyMid, smoothstep(0.12, 0.55, h));
  return mix(col, uSkyTop, smoothstep(0.5, 1.0, h));
}

float sunGlowAmount(vec3 dir) {
  float mu = max(dot(dir, uSunDir), 0.0);
  float nearHorizon = exp(-max(dir.y, 0.0) * 9.0);
  return pow(mu, 4.0) * (0.4 + 0.6 * nearHorizon) + pow(mu, 28.0) * 1.4 + pow(mu, 380.0) * 2.0 + nearHorizon * (0.3 + 0.7 * mu) * 0.45;
}

vec3 moonGlow(vec3 dir) {
  float moon = max(dot(dir, uMoonDir), 0.0);
  return ${rgb("#5d74a8")} * uNight * (pow(moon, 30.0) * 0.5 + pow(moon, 6.0) * 0.12);
}

vec3 skyBase(vec3 dir) {
  return skyGradient(clamp(max(dir.y, 0.0) / uSkySpan, 0.0, 1.0)) + uGlow * sunGlowAmount(dir) + moonGlow(dir);
}

float valleyMist(vec2 fragCoord) {
  vec2 uv = fragCoord / uTargetSize;
  vec2 outside = max(max(uVeil.xy - uv, uv - uVeil.zw), 0.0) / uVeilFeather;
  float drift = fbm(uv * vec2(3.0, 5.0) + 3.1, 3) * 0.9 + fbm(uv * vec2(9.0, 4.0) - 1.7, 2) * 0.35;
  float bank = 1.0 - smoothstep(0.0, 1.0, length(outside) + drift);
  return bank * (1.0 - smoothstep(0.35, 0.75, uNight));
}

vec3 mistPaint() {
  return skyGradient(0.07) + uGlow * 0.25;
}

float shadowHorizon(vec4 horizons) {
  return dot(horizons, uShadowMix) * 1.1 - 0.25;
}

float heightIntegral(float startY, float dirY, float dist, float falloff) {
  float k = dirY * falloff * dist;
  float shape = abs(k) < 1e-4 ? 1.0 - 0.5 * k : (1.0 - exp(-k)) / k;
  return exp(-startY * falloff) * dist * shape;
}

vec3 atmosphere(vec3 col, vec3 worldPos) {
  vec3 ray = worldPos - uCamPos;
  float dist = length(ray);
  vec3 dir = ray / max(dist, 1e-4);
  float haze = 1.0 - exp(-uHaze * heightIntegral(uCamPos.y, dir.y, dist, 0.00105));
  float mist = 1.0 - exp(-uMist * heightIntegral(uCamPos.y, dir.y, dist, 0.028));
  vec3 fogColor = skyBase(normalize(vec3(dir.x, max(dir.y, 0.012), dir.z)));
  fogColor += uKeyColor * pow(max(dot(dir, uSunDir), 0.0), 7.0) * 0.06 * (1.0 - uNight);
  col = mix(col, fogColor, haze);
  vec3 mistColor = mix(fogColor, vec3(1.0, 0.96, 0.92) * uAmbient * mix(0.8, 0.25, uNight), 0.35);
  return mix(col, mistColor, mist * 0.92);
}

vec3 encodeColor(vec3 c) {
  vec3 shoulder = 0.8 + 0.2 * (1.0 - exp(-(c - 0.8) / 0.2));
  c = mix(c, shoulder, step(0.8, c));
  return pow(max(c, 0.0), vec3(1.0 / 2.2));
}

const float CREATURE_REGION = 0.62;

vec4 encodeFlow(vec2 dir, float strokeScale, float region) {
  float angle = atan(dir.y, dir.x);
  return vec4(cos(2.0 * angle) * 0.5 + 0.5, sin(2.0 * angle) * 0.5 + 0.5, strokeScale, region);
}
`;

const FULLSCREEN_VS = `${HEADER}
out vec2 vUv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 1.0, 1.0);
}
`;

const BAKE_HEIGHT_FS = `${HEADER}${COMMON}
uniform vec2 uBakeSize;
layout(location = 0) out vec4 outHeight;
layout(location = 1) out vec4 outMaterial;

vec3 noised(vec2 x) {
  vec2 cell = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hash12(cell);
  float b = hash12(cell + vec2(1.0, 0.0));
  float c = hash12(cell + vec2(0.0, 1.0));
  float d = hash12(cell + vec2(1.0, 1.0));
  float k1 = b - a;
  float k2 = c - a;
  float k4 = a - b - c + d;
  return vec3(-1.0 + 2.0 * (a + k1 * u.x + k2 * u.y + k4 * u.x * u.y), 2.0 * du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}

float erodedFbm(vec2 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  vec2 slope = vec2(0.0);
  for (int i = 0; i < octaves; i++) {
    vec3 n = noised(p);
    slope += n.yz;
    sum += amp * n.x / (1.0 + dot(slope, slope));
    amp *= 0.5;
    p = OCTAVE_TURN * p * 2.0;
  }
  return sum;
}

float ridgedFbm(vec2 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float weight = 1.0;
  for (int i = 0; i < octaves; i++) {
    float n = 1.0 - abs(valueNoise(p));
    n *= n;
    sum += n * amp * weight;
    weight = clamp(n * 1.8, 0.0, 1.0);
    amp *= 0.5;
    p = OCTAVE_TURN * p * 2.07 + vec2(1.7, 9.2);
  }
  return sum;
}

float smax(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return max(a, b) + h * h * k * 0.25;
}

float dome(vec2 p, vec2 center, vec2 radius, float height) {
  float r = length((p - center) / radius);
  return height * pow(0.5 + 0.5 * cos(PI * min(r, 1.0)), 1.15);
}

float terrainHeight(vec2 p, out vec3 weights) {
  float meadow = meadowHeight(p);

  float dark = -1e4;
  float crestZ = 900.0 + 190.0 * valueNoise(vec2(p.x / 950.0, 4.2));
  float dz = p.y - crestZ;
  float profile = exp(-pow(dz / (dz < 0.0 ? 360.0 : 640.0), 2.0));
  if (profile > 0.002) {
    float rise = smoothstep(-60.0, 820.0, p.x);
    float detail = erodedFbm(p / 300.0 + vec2(5.3, 1.1), 7);
    float canopy = 0.55 + 0.45 * valueNoise(p / 10.0) + 0.3 * valueNoise(p / 4.1);
    dark = (190.0 * rise + 24.0 * smoothstep(-240.0, 60.0, p.x)) * profile + 38.0 * detail * profile * mix(0.4, 1.0, rise) + 9.0 * canopy * smoothstep(0.04, 0.3, profile) - 4.0 - 40.0 * (1.0 - profile);
  }

  float sage = -1e4;
  float sageBody = max(
    dome(p, vec2(-1700.0, 3800.0), vec2(2150.0, 1500.0), 880.0),
    dome(p, vec2(-120.0, 4550.0), vec2(1950.0, 1300.0), 470.0)
  );
  if (sageBody > 0.5) {
    sage = sageBody + 105.0 * erodedFbm(p / 760.0 + vec2(2.0, 7.0), 8) * smoothstep(0.0, 140.0, sageBody) - 12.0;
  }

  float far = -1e4;
  float farMask = smoothstep(6200.0, 8800.0, p.y) * (1.0 - smoothstep(14600.0, 15900.0, p.y));
  if (farMask > 0.001) {
    far = farMask * (1380.0 * ridgedFbm(p / 3900.0 + vec2(3.3, 8.1), 9) + 190.0 * erodedFbm(p / 1300.0, 6) - 140.0);
  }

  float h = smax(meadow, dark, 30.0);
  h = smax(h, sage, 140.0);
  h = smax(h, far, 260.0);
  weights = vec3(
    smoothstep(-16.0, 16.0, dark - max(meadow, max(sage, far))),
    smoothstep(-60.0, 60.0, sage - max(meadow, max(dark, far))),
    smoothstep(-110.0, 110.0, far - max(meadow, max(dark, sage)))
  );
  return h;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uBakeSize;
  vec2 p = terrainWorld(uv);
  vec2 texel = vec2(2.0 * (TW0 + p.y * TSLOPE) / uBakeSize.x, p.y * log(TZF / TZN) / uBakeSize.y);
  vec3 weights;
  vec3 ignored;
  float h = terrainHeight(p, weights);
  float hx = terrainHeight(p + vec2(texel.x, 0.0), ignored);
  float hz = terrainHeight(p + vec2(0.0, texel.y), ignored);
  vec2 gradient = vec2(hx - h, hz - h) / texel;
  float packedHeight = floor(clamp((h - HMIN) / HRANGE, 0.0, 1.0) * 65535.0);
  float high = floor(packedHeight / 256.0);
  outHeight = vec4(high / 255.0, (packedHeight - high * 256.0) / 255.0, gradient / (1.0 + abs(gradient)) * 0.5 + 0.5);
  outMaterial = vec4(weights, 1.0);
}
`;

const BAKE_AUX_FS = `${HEADER}${COMMON}
uniform sampler2D uHeightTex;
uniform vec4 uAzimuths;
layout(location = 0) out vec4 outAux;
layout(location = 1) out vec4 outHorizons;

float heightAt(vec2 p) {
  vec2 uv = terrainUv(p);
  if (uv.y > 1.0 || uv.x < 0.0 || uv.x > 1.0) return HMIN;
  ivec2 size = textureSize(uHeightTex, 0);
  ivec2 texel = clamp(ivec2(uv * vec2(size)), ivec2(0), size - 1);
  return decodeHeight(texelFetch(uHeightTex, texel, 0));
}

float horizonToward(vec2 p, float lifted, float azimuth) {
  vec2 dir = vec2(sin(azimuth), cos(azimuth));
  float t = max(0.6, p.y * 0.006);
  float maxSlope = -0.3;
  for (int i = 0; i < 46; i++) {
    maxSlope = max(maxSlope, (heightAt(p + dir * t) - lifted) / t);
    t *= 1.22;
    if (t > 26000.0) break;
  }
  return (atan(maxSlope) + 0.25) / 1.1;
}

void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(uHeightTex, 0);
  vec2 p = terrainWorld((vec2(coord) + 0.5) / vec2(size));
  float h0 = decodeHeight(texelFetch(uHeightTex, coord, 0));
  float lifted = h0 + 0.3 + p.y * 0.0015;
  outHorizons = vec4(
    horizonToward(p, lifted, uAzimuths.x),
    horizonToward(p, lifted, uAzimuths.y),
    horizonToward(p, lifted, uAzimuths.z),
    horizonToward(p, lifted, uAzimuths.w)
  );

  float radius = 1.5 + p.y * 0.012;
  float occlusion = 0.0;
  float neighborSum = 0.0;
  for (int k = 0; k < 8; k++) {
    float angle = float(k) * PI * 0.25 + 0.3;
    vec2 dir = vec2(cos(angle), sin(angle));
    float nearH = heightAt(p + dir * radius);
    float farH = heightAt(p + dir * radius * 3.5);
    occlusion += max(0.0, atan((nearH - h0) / radius)) + max(0.0, atan((farH - h0) / (radius * 3.5)));
    neighborSum += nearH;
  }
  float ao = 1.0 - clamp(occlusion / 16.0 * 2.2, 0.0, 1.0);
  float curvature = clamp((neighborSum / 8.0 - h0) / radius * 3.0, -1.0, 1.0);
  outAux = vec4(ao, curvature * 0.5 + 0.5, 0.0, 1.0);
}
`;

const TERRAIN_VS = `${HEADER}${COMMON}
layout(location = 0) in vec2 aUv;
uniform mat4 uViewProj;
uniform sampler2D uHeightTex;
uniform float uHillScale;
out vec2 vUv;
out vec3 vWorld;

void main() {
  vec2 p = terrainWorld(aUv);
  float h = p.y < 60.0 ? meadowHeight(p) : mix(meadowHeight(p), bakedHeight(uHeightTex, aUv), uHillScale);
  vWorld = vec3(p.x, h, p.y);
  vUv = aUv;
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}
`;

const TERRAIN_FS = `${HEADER}${COMMON}
uniform sampler2D uHeightTex;
uniform sampler2D uMaterialTex;
uniform sampler2D uAuxTex;
uniform sampler2D uHorizonTex;
uniform float uGrassFar;
in vec2 vUv;
in vec3 vWorld;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outFlow;

void main() {
  vec2 gradient = decodeGradient(texture(uHeightTex, vUv).ba);
  vec2 footprintAxes = max(abs(dFdx(vWorld.xz)), abs(dFdy(vWorld.xz)));
  float footprint = max(footprintAxes.x, footprintAxes.y);
  float detailScale = max(footprint * 6.0, 0.8);
  vec2 q = vWorld.xz / detailScale;
  float base = fbm(q, 3);
  gradient += vec2(fbm(q + vec2(0.35, 0.0), 3) - base, fbm(q + vec2(0.0, 0.35), 3) - base) / 0.35 * 0.3;
  vec3 n = normalize(vec3(-gradient.x, 1.0, -gradient.y));

  vec4 material = texture(uMaterialTex, vUv);
  vec4 aux = texture(uAuxTex, vUv);
  float horizon = shadowHorizon(texture(uHorizonTex, vUv));
  float ao = aux.r;
  float curvature = aux.g * 2.0 - 1.0;
  float slope = 1.0 - n.y;

  float patchNoise = fbm(vWorld.xz * 0.006, 4);
  vec3 meadow = mix(${rgb("#5b7a33")}, ${rgb("#8f9a4a")}, smoothstep(-0.3, 0.4, patchNoise));
  meadow *= mix(0.5, 1.0, smoothstep(uGrassFar * 0.55, uGrassFar * 1.6, vWorld.z));
  vec3 forest = mix(${rgb("#164536")}, ${rgb("#3c7259")}, smoothstep(-0.25, 0.55, patchNoise + fbm(vWorld.xz * 0.03, 3) * 0.5));
  vec3 sage = mix(${rgb("#8ba65c")}, ${rgb("#b9c482")}, smoothstep(-0.35, 0.45, fbm(vWorld.xz * 0.0021 + 3.0, 4)));
  sage = mix(sage, ${rgb("#a39b80")}, smoothstep(0.45, 0.75, slope) * 0.45);
  vec3 farLand = mix(${rgb("#7b9474")}, ${rgb("#9a9ca4")}, smoothstep(0.28, 0.55, slope) * 0.8 + smoothstep(600.0, 1300.0, vWorld.y) * 0.4);

  float wDark = material.r;
  float wSage = material.g * (1.0 - wDark);
  float wFar = material.b * (1.0 - wDark) * (1.0 - wSage);
  vec3 albedo = meadow;
  albedo = mix(albedo, farLand, wFar);
  albedo = mix(albedo, sage, wSage);
  albedo = mix(albedo, forest, wDark);
  albedo *= mix(1.0, 0.8, clamp(curvature, 0.0, 1.0)) * mix(1.0, 1.15, clamp(-curvature, 0.0, 1.0));
  albedo = mix(albedo, ${rgb("#0f3b33")} * 1.4, uNight * 0.55);

  vec3 L = uKeyDir;
  vec3 V = normalize(uCamPos - vWorld);
  float lit = smoothstep(-0.014, 0.014, uKeyElev - horizon);
  float wrap = max((dot(n, L) + 0.35) / 1.35, 0.0);
  vec3 skyLight = skyBase(normalize(vec3(n.x * 0.6, max(n.y, 0.0) + 0.45, n.z * 0.6)));
  float skyLuma = dot(skyLight, vec3(0.2126, 0.7152, 0.0722));
  vec3 hillShade = mix(skyLight, skyLuma * ${rgb("#9fd0bc")} * 1.25, (wDark + wSage) * 0.6 * (1.0 - uNight));
  vec3 ambient = hillShade * mix(0.5, 1.0, ao) * 1.15 * uAmbient;
  ambient += skyLight * max(dot(n, normalize(vec3(-L.x, 0.6, -L.z))), 0.0) * 0.55 * mix(0.6, 1.0, ao) * uAmbient;
  vec3 direct = uKeyColor * wrap * lit * 0.85;
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0) * pow(max(dot(-V, L), 0.0), 2.0);
  vec3 col = albedo * (ambient + direct) + uKeyColor * rim * lit * 0.18 * (1.0 - wFar);
  col = mix(atmosphere(col, vWorld), col, (wDark * 0.8 + wSage * 0.55) * (1.0 - uNight * 0.5));
  col = mix(col, mistPaint(), valleyMist(gl_FragCoord.xy) * 0.82);
  outColor = vec4(encodeColor(col), 1.0);

  vec2 screenSlope = vec2(dFdx(vWorld.y), dFdy(vWorld.y)) + vec2(dFdx(vWorld.z), dFdy(vWorld.z)) * 0.02;
  vec2 contour = length(screenSlope) > 1e-5 ? vec2(screenSlope.y, -screenSlope.x) : vec2(1.0, 0.0);
  outFlow = encodeFlow(contour, mix(0.85, 0.6, wDark), 0.5);
}
`;

const SKY_FS = `${HEADER}${COMMON}
const float SKY_BANDS = 7.0;
uniform mat4 uInvViewProj;
uniform float uSunRadius;
uniform vec2 uSunNdc;
uniform float uSunDiscNdc;
uniform float uAspect;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outFlow;

void main() {
  vec4 farPoint = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(farPoint.xyz / farPoint.w - uCamPos);
  float mu = max(dot(dir, uSunDir), 0.0);
  vec2 plane = dir.xz / (dir.y + 0.07);
  float h = clamp(max(dir.y, 0.0) / uSkySpan, 0.0, 1.0);
  float wobble = fbm(vec2(plane.x * 0.35 + uTime * 0.004, h * 2.5 + 1.7), 3) * 0.045;
  float bandPosition = (h + wobble) * SKY_BANDS;
  float bandEdge = smoothstep(0.8, 1.0, fract(bandPosition));
  float bandH = clamp((floor(bandPosition) + bandEdge + 0.5) / SKY_BANDS, 0.0, 1.0);
  float glow = sunGlowAmount(dir);
  float glowSteps = floor(glow * 6.0) / 6.0 + smoothstep(0.75, 1.0, fract(glow * 6.0)) / 6.0;
  vec3 col = mix(skyGradient(h), skyGradient(bandH), 0.82) + uGlow * mix(glow, glowSteps, 0.7) + moonGlow(dir);

  if (dir.y > 0.0) {
    vec2 drift = vec2(uTime * 0.006, uTime * 0.0015);
    float body = fbm(plane * vec2(0.5, 1.5) + drift + vec2(3.1, 0.4), 5);
    float streak = fbm(plane * vec2(0.22, 2.6) + drift * 0.7 + vec2(-1.3, 5.0), 4);
    float cover = smoothstep(0.3, 0.36, body * 0.75 + streak * 0.55) * smoothstep(0.04, 0.2, h) * (1.0 - smoothstep(0.5, 0.9, h));
    vec3 lit = mix(uSkyHorizon * 1.12 + uGlow * 0.6, ${rgb("#5a6b9a")}, uNight);
    vec3 shade = mix(mix(uSkyMid, uSkyTop, 0.5) * 0.94, ${rgb("#1c2748")}, uNight);
    vec3 cloud = mix(shade, lit, smoothstep(0.02, 0.08, streak)) + uGlow * pow(mu, 6.0) * 1.2;
    col = mix(col, cloud, cover * 0.62);
    vec2 starCell = floor(plane * 90.0);
    float stars = step(0.9965, hash12(starCell)) * smoothstep(0.1, 0.4, dir.y / uSkySpan);
    col += vec3(0.9, 0.92, 1.0) * stars * uNight * (0.6 + 0.4 * sin(uTime * 3.0 + hash12(starCell + 3.0) * 30.0));
  }

  float c = dot(dir, uSunDir);
  float angle = sqrt(max(2.0 * (1.0 - c), 0.0));
  float edge = fwidth(angle) * 1.2;
  float disc = 1.0 - smoothstep(uSunRadius - edge, uSunRadius + edge, angle);
  float limb = clamp(angle / uSunRadius, 0.0, 1.0);
  float daylight = smoothstep(0.0, 0.25, uSunDir.y);
  vec3 sunCore = mix(${rgb("#ff9238")}, ${rgb("#f9bb34")}, daylight);
  vec3 sunRim = mix(${rgb("#e45a28")}, ${rgb("#ec9420")}, daylight);
  col = mix(col, mix(sunCore, sunRim, limb * limb), disc);

  float moonAngle = sqrt(max(2.0 * (1.0 - dot(dir, uMoonDir)), 0.0));
  float moonDisc = (1.0 - smoothstep(uSunRadius * 0.8 - edge, uSunRadius * 0.8 + edge, moonAngle)) * uNight;
  col = mix(col, ${rgb("#f4efdc")} * mix(0.9, 1.0, valueNoise(dir.xy * 140.0) * 0.5 + 0.5), moonDisc);
  outColor = vec4(encodeColor(col), 1.0);

  vec2 ndc = vUv * 2.0 - 1.0;
  vec2 fromSun = (ndc - uSunNdc) * vec2(uAspect, 1.0);
  float sunDistance = length(fromSun);
  vec2 swirl = vec2(-fromSun.y, fromSun.x);
  float warp = fbm(plane * 0.7 + vec2(uTime * 0.01, 0.0), 3);
  vec2 sweep = vec2(1.0, 0.35 * warp + 0.12 * sin(ndc.x * 2.5 + ndc.y * 4.0));
  vec2 flow = mix(normalize(swirl + 1e-4), normalize(sweep), smoothstep(0.08, 0.55, sunDistance));
  outFlow = encodeFlow(flow, mix(0.0, 1.0, smoothstep(uSunDiscNdc * 1.1, uSunDiscNdc * 5.0, sunDistance)), 0.0);
}
`;

const GRASS_VS = `${HEADER}${COMMON}
layout(location = 0) in vec2 aBlade;
uniform mat4 uViewProj;
uniform vec2 uGrid;
uniform vec4 uGrassArea;
uniform float uWind;
uniform vec2 uWindDir;
uniform float uPixelAngle;
uniform sampler2D uBrushTex;
uniform sampler2D uHorizonTex;
uniform vec4 uMobs[${MOB_CONTACTS}];
uniform int uMobCount;
uniform vec2 uMobShadow;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vTint;
out float vAlong;
out float vLit;
out float vSide;
out float vBrushed;
out float vGlow;
out float vFlower;
out float vShade;

const float SEGMENTS = ${float(GRASS_SEGMENTS)};

void main() {
  int columns = int(uGrid.x);
  vec2 cellIndex = vec2(float(gl_InstanceID % columns), float(gl_InstanceID / columns));
  float h1 = hash12(cellIndex + 0.37);
  float h2 = hash12(cellIndex + 17.3);
  float h3 = hash12(cellIndex + 41.7);
  float h4 = hash12(cellIndex + 73.1);
  float h5 = hash12(cellIndex + 5.9);
  vec2 cell = (cellIndex + vec2(h1, h2)) / uGrid;
  float depthT = pow(cell.y, ${float(GRASS_DEPTH_CURVE)});
  float z = 1.0 / mix(1.0 / uGrassArea.x, 1.0 / uGrassArea.y, depthT);
  vec2 root = vec2((cell.x * 2.0 - 1.0) * (uGrassArea.z + z * uGrassArea.w), z);
  float ground = meadowHeight(root) - 0.02;
  float flower = step(0.9955, h4) * (1.0 - smoothstep(4.0, 12.0, z));

  float clump = valueNoise(root * 1.6) * 0.5 + 0.5;
  float meadowPatch = valueNoise(root * 0.21 + 11.0) * 0.5 + 0.5;
  float height = mix(0.22, 0.6, h3) * mix(0.6, 1.2, clump) * mix(0.75, 1.12, meadowPatch);
  height = mix(height, 0.42 + 0.16 * h3, flower);
  height *= mix(1.0, 0.4, smoothstep(uGrassArea.y * 0.55, uGrassArea.y, z));
  float trample = 0.0;
  float shade = 0.0;
  vec2 away = vec2(0.0);
  for (int i = 0; i < ${MOB_CONTACTS}; i++) {
    if (i >= uMobCount) break;
    vec4 mob = uMobs[i];
    vec2 d = root - mob.xy;
    vec2 reach = d / mob.z;
    reach.y *= d.y < 0.0 ? 0.42 : 1.0;
    float inside = 1.0 - dot(reach, reach);
    if (inside > 0.0) {
      inside *= inside * mob.w;
      trample = max(trample, inside);
      away += d / max(length(d), 1e-3) * inside;
    }
    vec2 footprint = (d - uMobShadow * mob.z) / (mob.z * 0.8);
    shade = max(shade, (1.0 - min(dot(footprint, footprint), 1.0)) * mob.w);
  }
  height *= 1.0 - 0.75 * trample;
  vShade = shade;
  float pixelWorld = z * uPixelAngle;
  float width = max(mix(0.01, 0.02, h4) * mix(1.3, 0.9, clump), pixelWorld * 1.6);

  float facing = h5 * 6.2831853;
  vec2 facingDir = vec2(cos(facing), sin(facing));
  float gust = valueNoise(root * 0.09 - uWindDir * uTime * 0.85) * 0.5 + 0.5;
  gust = gust * gust * (3.0 - 2.0 * gust);
  float ripple = valueNoise(root * 0.42 - uWindDir * uTime * 1.9);
  float flutter = sin(uTime * (2.4 + h1 * 1.6) + h2 * 6.2831853 + dot(root, uWindDir) * 1.4);
  float windBend = uWind * (0.1 + 0.62 * gust + 0.12 * ripple + 0.06 * flutter + flower * 0.12 * flutter);
  vec2 bendVec = facingDir * mix(0.08, 0.42, h1) * (1.0 - flower * 0.7) + uWindDir * windBend;
  vec3 brushSample = texture(uBrushTex, vec2(cell.x, depthT)).xyz;
  vec2 brush = brushSample.xy;
  bendVec += brush * (1.0 + flower * 0.4) + away * 0.9;
  vBrushed = clamp(length(brush) / 1.1, 0.0, 1.0);
  vGlow = brushSample.z * mix(0.12, 1.0, step(0.58, h3) * (0.6 + 0.4 * h5)) * (1.0 - smoothstep(10.0, 30.0, z));
  float bend = length(bendVec);
  vec2 bendDir = bend > 1e-4 ? bendVec / bend : facingDir;
  bend = min(bend, 1.5);

  float s = aBlade.x / SEGMENTS;
  float arc = bend * s;
  float safeBend = max(bend, 1e-3);
  float outward = height * (1.0 - cos(arc)) / safeBend;
  float upward = height * sin(arc) / safeBend;
  vec3 spine = vec3(root.x, ground, root.y) + vec3(bendDir.x * outward, upward, bendDir.y * outward);
  vec3 tangent = vec3(bendDir.x * sin(arc), cos(arc), bendDir.y * sin(arc));

  vec3 toCamera = normalize(uCamPos - spine);
  vec3 across = vec3(-facingDir.y, 0.0, facingDir.x);
  vec3 cameraAcross = normalize(cross(vec3(0.0, 1.0, 0.0), toCamera));
  across = normalize(mix(across, cameraAcross * (dot(across, cameraAcross) < 0.0 ? -1.0 : 1.0), 0.6));
  float taper = pow(max(1.0 - s, 0.0), 0.62);
  float head = smoothstep(0.78, 0.9, s) * (1.0 - smoothstep(0.94, 1.0, s));
  float profile = mix(taper, 0.28 + head * 2.6, flower);
  vec3 position = spine + across * aBlade.y * width * profile * 0.5;

  vec3 normal = normalize(cross(across, tangent));
  if (dot(normal, toCamera) < 0.0) normal = -normal;
  vNormal = normalize(normal + across * aBlade.y * 0.55);

  vec3 deep = ${rgb("#355d2f")};
  vec3 fresh = ${rgb("#7a963f")};
  vec3 dry = ${rgb("#b8a764")};
  vTint = mix(mix(fresh, deep, h2 * 0.75), dry, smoothstep(0.86, 0.98, h4) * 0.7);
  vTint = mix(vTint, ${rgb("#94a24b")}, smoothstep(0.55, 0.9, meadowPatch) * 0.45);
  float petal = hash12(cellIndex + 91.0);
  vec3 bloom = petal < 0.35 ? ${rgb("#f6efe0")} : petal < 0.6 ? ${rgb("#f2bf3a")} : petal < 0.8 ? ${rgb("#e98aa0")} : ${rgb("#9c8fd6")};
  vTint = mix(vTint, bloom, flower * step(0.8, s));
  vFlower = flower;
  vAlong = s;
  vSide = aBlade.y;
  vLit = smoothstep(-0.014, 0.014, uKeyElev - shadowHorizon(texture(uHorizonTex, terrainUv(root))));
  vWorld = position;
  gl_Position = uViewProj * vec4(position, 1.0);
}
`;

const GRASS_FS = `${HEADER}${COMMON}
in vec3 vWorld;
in vec3 vNormal;
in vec3 vTint;
in float vAlong;
in float vLit;
in float vSide;
in float vBrushed;
in float vGlow;
in float vFlower;
in float vShade;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outFlow;

void main() {
  vec3 n = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  vec3 L = uKeyDir;
  float s = vAlong;
  float petals = vFlower * step(0.8, s);
  vec3 albedo = mix(${rgb("#16301a")}, vTint, max(smoothstep(0.0, 0.6, s), petals));
  albedo = mix(albedo, ${rgb("#b4b26e")}, smoothstep(0.65, 1.0, s) * 0.3 * (1.0 - petals));
  albedo = mix(albedo, ${rgb("#0c3d2b")} * 1.6, uNight * 0.6 * (1.0 - petals));
  albedo = mix(albedo, ${rgb("#22200f")}, vBrushed * 0.6 * (1.0 - petals) * (1.0 - uNight));
  float ao = mix(0.28, 1.0, smoothstep(0.0, 0.8, s)) * (1.0 - vBrushed * 0.82 * (1.0 - s * 0.25)) * (1.0 - vShade * 0.5 * (1.0 - s * 0.5));
  float wrap = max(dot(n, L) * 0.5 + 0.5, 0.0);
  float backlight = pow(max(dot(-V, L), 0.0), 8.0);
  float edge = smoothstep(0.35, 1.0, abs(vSide));
  float translucency = backlight * smoothstep(0.3, 1.0, s) * (0.3 + 0.7 * edge);
  vec3 skyLight = skyBase(normalize(vec3(n.x * 0.5, 0.75, n.z * 0.5)));
  vec3 col = albedo * (skyLight * 0.8 * ao * uAmbient + uKeyColor * wrap * vLit * ao * 0.62);
  col += albedo * ${rgb("#f2e48a")} * uKeyColor * translucency * vLit * 1.1 * (1.0 - uNight);
  float underside = vGlow * smoothstep(0.25, 1.0, s) + vBrushed * 0.18 * s;
  col += mix(${rgb("#1f9c7c")}, ${rgb("#b4f5dc")}, s * vGlow) * underside * uNight * 0.36;
  col = atmosphere(col, vWorld);
  col = mix(col, mistPaint(), valleyMist(gl_FragCoord.xy) * 0.82);
  outColor = vec4(encodeColor(col), 1.0);
  vec2 along = vec2(dFdx(vAlong), dFdy(vAlong));
  outFlow = encodeFlow(length(along) > 1e-6 ? along : vec2(0.0, 1.0), mix(0.32, 0.18, petals), 1.0);
}
`;


const MOB_VS = `${HEADER}${COMMON}
layout(location = 0) in vec3 aCorner;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aRoot;
layout(location = 3) in vec4 aPivot;
layout(location = 4) in vec4 aOffset;
layout(location = 5) in vec4 aSize;
layout(location = 6) in vec4 aColor;
layout(location = 7) in vec4 aExtra;
uniform mat4 uViewProj;
uniform sampler2D uHorizonTex;
uniform sampler2D uHeightTex;
uniform float uHillScale;
uniform float uPx;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out vec3 vLocal;
out vec2 vStroke;
out float vFade;
out float vGlow;
out float vFlash;
out float vSeed;
out float vLit;
out float vGround;

mat3 turnY(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}

mat3 turnX(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}

mat3 turnZ(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
}

void main() {
  vec3 local = aOffset.xyz + aCorner * aSize.xyz;
  mat3 part = turnY(aRoot.z) * turnY(aPivot.w) * turnX(aOffset.w) * turnZ(aSize.w);
  vec3 model = turnY(aRoot.z) * aPivot.xyz + part * local;
  float meadow = meadowHeight(aRoot.xy);
  float ground = aRoot.y < 60.0 ? meadow : mix(meadow, bakedHeight(uHeightTex, terrainUv(aRoot.xy)), uHillScale);
  vec3 world = vec3(aRoot.x, ground - 0.02 + aRoot.w, aRoot.y) + model * uPx;
  vec3 size = aSize.xyz;
  vec3 major = size.x >= size.y && size.x >= size.z ? vec3(1.0, 0.0, 0.0) : size.y >= size.z ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
  vec4 clip = uViewProj * vec4(world, 1.0);
  vec4 ahead = uViewProj * vec4(world + part * major * 0.05, 1.0);
  vStroke = (ahead.xy / ahead.w - clip.xy / clip.w) * uTargetSize;
  vNormal = part * aNormal;
  vWorld = world;
  vLocal = local;
  vColor = aColor.rgb;
  vFade = aColor.a;
  vGlow = aExtra.x;
  vSeed = aExtra.y;
  vFlash = aExtra.z;
  vGround = model.y * uPx;
  vLit = smoothstep(-0.014, 0.014, uKeyElev - shadowHorizon(texture(uHorizonTex, terrainUv(aRoot.xy))));
  gl_Position = clip;
}
`;

const MOB_FS = `${HEADER}${COMMON}
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in vec3 vLocal;
in vec2 vStroke;
in float vFade;
in float vGlow;
in float vFlash;
in float vSeed;
in float vLit;
in float vGround;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outFlow;

void main() {
  float dissolve = valueNoise(gl_FragCoord.xy * 0.21 + vSeed * 3.1) * 0.5 + 0.5;
  if (dissolve > vFade * 1.12 - 0.06) discard;
  vec3 n = normalize(vNormal);
  vec3 L = uKeyDir;
  vec3 V = normalize(uCamPos - vWorld);
  float texel = hash12(floor(vLocal.xy * 0.5) + floor(vLocal.z * 0.5) * 7.31 + vSeed);
  vec3 albedo = vColor * (0.9 + 0.2 * texel);
  albedo = mix(albedo, vec3(1.0), vFlash);
  albedo = mix(albedo, albedo * ${rgb("#8fa3d4")}, uNight * 0.45);
  float ao = mix(0.5, 1.0, smoothstep(0.0, 0.5, vGround));
  float wrap = max((dot(n, L) + 0.6) / 1.6, 0.0);
  vec3 skyLight = skyBase(normalize(vec3(n.x * 0.6, max(n.y, 0.0) + 0.45, n.z * 0.6)));
  vec3 bounce = ${rgb("#b7b56a")} * (1.0 - max(n.y, 0.0)) * (1.0 - uNight * 0.7);
  vec3 col = albedo * ((skyLight * 0.75 + bounce * 0.35) * uAmbient * ao + uKeyColor * wrap * vLit * 0.62 * ao);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 2.0) * pow(max(dot(-V, L), 0.0), 2.0);
  col += uKeyColor * rim * vLit * 0.12;
  col *= mix(1.0, 1.35, uNight);
  col += vColor * vGlow * mix(0.5, 1.8, uNight);
  col = mix(atmosphere(col, vWorld), col, smoothstep(150.0, 900.0, vWorld.z) * 0.6 * (1.0 - uNight * 0.5));
  col = mix(mistPaint(), col, smoothstep(0.0, 0.75, vFade));
  outColor = vec4(encodeColor(col), 1.0);
  outFlow = encodeFlow(length(vStroke) > 1e-4 ? vStroke : vec2(0.0, 1.0), 0.08, CREATURE_REGION);
}
`;

const PAINT_FS = `${HEADER}
uniform sampler2D uScene;
uniform sampler2D uFlow;
uniform vec2 uTexel;
uniform float uRadius;
in vec2 vUv;
out vec4 outColor;

void main() {
  vec4 flow = texture(uFlow, vUv);
  vec2 orientation = flow.xy * 2.0 - 1.0;
  float coherence = clamp(length(orientation), 0.0, 1.0);
  float angle = 0.5 * atan(orientation.y, orientation.x);
  vec2 along = vec2(cos(angle), sin(angle));
  vec2 across = vec2(-along.y, along.x);
  float radius = uRadius * mix(0.7, 1.6, flow.z);
  float stretch = mix(1.0, 2.3, coherence);
  vec2 axisA = along * radius * stretch * uTexel;
  vec2 axisB = across * radius / stretch * uTexel;
  vec3 sum0 = vec3(0.0), sum1 = vec3(0.0), sum2 = vec3(0.0), sum3 = vec3(0.0);
  vec3 sq0 = vec3(0.0), sq1 = vec3(0.0), sq2 = vec3(0.0), sq3 = vec3(0.0);
  float w0 = 0.0, w1 = 0.0, w2 = 0.0, w3 = 0.0;
  for (int j = -3; j <= 3; j++) {
    for (int i = -3; i <= 3; i++) {
      vec2 q = vec2(float(i), float(j)) / 3.0;
      float d2 = dot(q, q);
      if (d2 > 1.05) continue;
      vec3 c = texture(uScene, vUv + axisA * q.x + axisB * q.y).rgb;
      float w = exp(-d2 * 1.6);
      vec3 cw = c * w;
      vec3 c2w = c * c * w;
      if (q.x >= 0.0 && q.y >= 0.0) { sum0 += cw; sq0 += c2w; w0 += w; }
      if (q.x <= 0.0 && q.y >= 0.0) { sum1 += cw; sq1 += c2w; w1 += w; }
      if (q.x <= 0.0 && q.y <= 0.0) { sum2 += cw; sq2 += c2w; w2 += w; }
      if (q.x >= 0.0 && q.y <= 0.0) { sum3 += cw; sq3 += c2w; w3 += w; }
    }
  }
  vec3 m0 = sum0 / w0, m1 = sum1 / w1, m2 = sum2 / w2, m3 = sum3 / w3;
  float v0 = dot(abs(sq0 / w0 - m0 * m0), vec3(1.0));
  float v1 = dot(abs(sq1 / w1 - m1 * m1), vec3(1.0));
  float v2 = dot(abs(sq2 / w2 - m2 * m2), vec3(1.0));
  float v3 = dot(abs(sq3 / w3 - m3 * m3), vec3(1.0));
  float k0 = 1.0 / (1.0 + pow(v0 * 900.0, 2.0));
  float k1 = 1.0 / (1.0 + pow(v1 * 900.0, 2.0));
  float k2 = 1.0 / (1.0 + pow(v2 * 900.0, 2.0));
  float k3 = 1.0 / (1.0 + pow(v3 * 900.0, 2.0));
  vec3 color = (m0 * k0 + m1 * k1 + m2 * k2 + m3 * k3) / (k0 + k1 + k2 + k3);
  float levels = mix(26.0, 18.0, step(flow.a, 0.25));
  color = mix(color, floor(color * levels + 0.5) / levels, 0.35);
  outColor = vec4(color, 1.0);
}
`;

const STROKE_CELLS = `
uniform sampler2D uFlow;
uniform vec2 uResolution;
uniform float uDpr;

vec2 hash22(vec2 p) {
  return vec2(hash12(p), hash12(p + 19.19));
}

vec2 strokeCenter(vec2 id, float cellSize) {
  return (id + hash22(id)) * cellSize;
}

vec4 strokeShape(vec2 id, vec2 center, out vec2 along) {
  vec2 jitter = hash22(id);
  vec4 flow = texture(uFlow, center / uResolution);
  vec2 orientation = flow.xy * 2.0 - 1.0;
  float angle = 0.5 * atan(orientation.y, orientation.x) + (jitter.x - 0.5) * 0.28;
  along = vec2(cos(angle), sin(angle));
  float size = mix(0.4, 1.0, flow.z);
  float halfLength = mix(11.0, 27.0, size) * uDpr * (0.85 + jitter.y * 0.3);
  float halfWidth = mix(3.4, 7.5, size) * uDpr * (0.85 + jitter.x * 0.3);
  return vec4(halfLength, halfWidth, flow.a, hash12(id + 7.13));
}
`;

const CELL_FS = `${HEADER}${COMMON}${STROKE_CELLS}
uniform vec2 uCellOrigin;
layout(location = 0) out vec4 outShape;
layout(location = 1) out vec4 outStroke;

void main() {
  vec2 id = floor(gl_FragCoord.xy) + uCellOrigin;
  vec2 center = strokeCenter(id, 16.0 * uDpr);
  vec2 along;
  outStroke = strokeShape(id, center, along);
  outShape = vec4(center, along);
}
`;

const FINAL_FS = `${HEADER}${COMMON}${STROKE_CELLS}
uniform sampler2D uPaint;
uniform sampler2D uSmear;
uniform sampler2D uHorizonTex;
uniform highp sampler2D uCellShape;
uniform highp sampler2D uCellStroke;
uniform bool uCellTable;
uniform vec2 uCellOrigin;
uniform ivec2 uCellCount;
uniform vec3 uLight;
uniform vec3 uSpecColor;
uniform vec2 uSunPx;
uniform vec2 uMoonPx;
uniform float uSunRadiusPx;
uniform float uRelief;
in vec2 vUv;
out vec4 outColor;

void main() {
  vec2 pixel = gl_FragCoord.xy;
  vec2 smear = texture(uSmear, pixel / uResolution).xy;
  float regionAtPixel = texture(uFlow, pixel / uResolution).a;
  vec2 painted = pixel - smear * uResolution * mix(0.35, 1.0, regionAtPixel);
  float creatureAtPixel = step(abs(regionAtPixel - CREATURE_REGION), 0.04);
  vec2 uv = painted / uResolution;
  vec3 base = texture(uPaint, uv).rgb;

  float cellSize = 16.0 * uDpr;
  float reach = 32.3 * uDpr;
  float reach2 = reach * reach;
  vec2 cell = floor(painted / cellSize);
  float bestOrder = -1.0;
  vec2 bestLocal = vec2(0.0);
  vec2 bestCenter = vec2(0.0);
  float bestSeed = 0.0;
  float bestRegion = 0.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 id = cell + vec2(float(i), float(j));
      ivec2 slot = ivec2(id - uCellOrigin);
      bool cached = uCellTable && all(greaterThanEqual(slot, ivec2(0))) && all(lessThan(slot, uCellCount));
      vec2 center;
      vec2 along;
      vec4 shape;
      if (cached) {
        shape = texelFetch(uCellShape, slot, 0);
        center = shape.xy;
      } else {
        center = strokeCenter(id, cellSize);
      }
      vec2 d = painted - center;
      if (dot(d, d) > reach2) continue;
      vec4 stroke;
      if (cached) {
        along = shape.zw;
        stroke = texelFetch(uCellStroke, slot, 0);
      } else {
        stroke = strokeShape(id, center, along);
      }
      float a = dot(d, along) / stroke.x;
      float b = dot(d, vec2(-along.y, along.x)) / (stroke.y * (1.0 - 0.35 * smoothstep(0.1, 1.0, a)));
      if (pow(abs(a), 2.6) + b * b < 1.0 && step(abs(stroke.z - CREATURE_REGION), 0.04) >= creatureAtPixel) {
        if (stroke.w > bestOrder) {
          bestOrder = stroke.w;
          bestLocal = vec2(a, b);
          bestCenter = center;
          bestSeed = hash12(id + 19.19);
          bestRegion = stroke.z;
        }
      }
    }
  }

  float height = 0.0;
  vec3 color = base;
  if (bestOrder >= 0.0) {
    float across = abs(bestLocal.y);
    float body = sqrt(max(1.0 - across * across, 0.0)) * (1.0 - smoothstep(0.8, 1.0, abs(bestLocal.x)));
    float groove = 1.0 - abs(valueNoise(vec2(bestLocal.x * 0.8, bestLocal.y * 4.2) + bestSeed * 61.0));
    float lip = exp(-pow((bestLocal.x - 0.8) / 0.12, 2.0)) * (1.0 - across * 0.7);
    float banks = smoothstep(0.6, 0.86, across) * (1.0 - smoothstep(0.86, 1.0, across));
    float gain = bestRegion < 0.25 ? 0.78 : bestRegion < 0.75 ? 1.0 : 0.7;
    height = (0.4 * body + 0.3 * groove * groove * body + 0.34 * lip + 0.2 * banks + bestOrder * 0.16) * gain;
    vec3 dab = texture(uPaint, bestCenter / uResolution).rgb * (0.96 + bestSeed * 0.08);
    color = mix(base, dab, 0.55) * (1.0 - 0.05 * bestLocal.x);
  }
  vec2 weave = sin(pixel / uDpr * vec2(1.05, 1.15));
  float grain = weave.x * weave.y * 0.5 + valueNoise(pixel / uDpr * 0.7) * 0.5;
  height += grain * 0.012;

  vec3 normal = normalize(vec3(-dFdx(height) * uRelief / uDpr, -dFdy(height) * uRelief / uDpr, 1.0));
  float diffuse = dot(normal, uLight) - uLight.z;
  vec3 halfway = normalize(uLight + vec3(0.0, 0.0, 1.0));
  float spec = max(pow(max(dot(normal, halfway), 0.0), 18.0) - pow(halfway.z, 18.0), 0.0);
  color = color * (1.0 + diffuse * 0.8) * (1.0 + grain * 0.03) + uSpecColor * spec * mix(0.1, 0.22, bestRegion);

  float sunDistance = length(pixel - uSunPx);
  float sunVisible = smoothstep(-0.03, 0.06, asin(uSunDir.y) - shadowHorizon(texture(uHorizonTex, terrainUv(uCamPos.xz))));
  float glow = exp(-max(sunDistance - uSunRadiusPx, 0.0) / (uSunRadiusPx * 0.8)) * 0.4 + exp(-sunDistance / (uSunRadiusPx * 5.0)) * 0.14;
  color += pow(uGlow * 1.4 + vec3(0.035, 0.018, 0.0), vec3(1.0 / 2.2)) * glow * 0.5 * sunVisible * (1.0 - uNight);
  float moonDistance = length(pixel - uMoonPx);
  color += vec3(0.55, 0.62, 0.8) * exp(-max(moonDistance - uSunRadiusPx * 0.8, 0.0) / (uSunRadiusPx * 1.4)) * 0.3 * uNight;

  color += (hash12(pixel + fract(uTime * 3.7) * 97.0) - 0.5) / 255.0;
  outColor = vec4(color, 1.0);
}
`;

const PROBE_FS = `${HEADER}
uniform sampler2D uSource;
uniform vec2 uHalfSize;
uniform vec2 uProbeSize;
out vec4 outColor;

vec4 halfTexel(vec2 cell) {
  return texture(uSource, (clamp(cell, vec2(0.0), uHalfSize - 1.0) + 0.5) / uHalfSize);
}

void main() {
  vec2 st = gl_FragCoord.xy / uProbeSize * uHalfSize - 0.5;
  vec2 cell = floor(st);
  vec2 f = st - cell;
  vec4 bottom = mix(halfTexel(cell), halfTexel(cell + vec2(1.0, 0.0)), f.x);
  vec4 top = mix(halfTexel(cell + vec2(0.0, 1.0)), halfTexel(cell + vec2(1.0, 1.0)), f.x);
  outColor = mix(bottom, top, f.y);
}
`;

const PARTICLE_VS = `${HEADER}
layout(location = 0) in vec4 aPlace;
layout(location = 1) in vec4 aColor;
layout(location = 2) in float aKind;
uniform vec2 uResolution;
out vec4 vColor;
out float vKind;
out float vAngle;
void main() {
  vColor = aColor;
  vKind = aKind;
  vAngle = aPlace.w;
  gl_Position = vec4(aPlace.x / uResolution.x * 2.0 - 1.0, 1.0 - aPlace.y / uResolution.y * 2.0, 0.0, 1.0);
  gl_PointSize = aPlace.z;
}
`;

const PARTICLE_FS = `${HEADER}
in vec4 vColor;
in float vKind;
in float vAngle;
out vec4 outColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  if (vKind < 0.5) {
    float r2 = dot(q, q);
    float glow = exp(-r2 * 5.0) * 0.8 + exp(-r2 * 40.0) * 1.2;
    outColor = vec4(vColor.rgb * glow, 0.0);
    return;
  }
  vec2 r = mat2(cos(vAngle), sin(vAngle), -sin(vAngle), cos(vAngle)) * q;
  float shape = length(vec2(r.x, r.y * 1.9 + r.x * r.x * 0.6));
  float alpha = (1.0 - smoothstep(0.78, 0.95, shape)) * vColor.a;
  float shade = 0.82 + 0.18 * r.y;
  outColor = vec4(vColor.rgb * shade * alpha / max(vColor.a, 1e-3), alpha);
}
`;

export const SHADERS = {
  fullscreenVs: FULLSCREEN_VS,
  bakeHeightFs: BAKE_HEIGHT_FS,
  bakeAuxFs: BAKE_AUX_FS,
  terrainVs: TERRAIN_VS,
  terrainFs: TERRAIN_FS,
  skyFs: SKY_FS,
  grassVs: GRASS_VS,
  grassFs: GRASS_FS,
  paintFs: PAINT_FS,
  finalFs: FINAL_FS,
  cellFs: CELL_FS,
  probeFs: PROBE_FS,
  particleVs: PARTICLE_VS,
  particleFs: PARTICLE_FS,
  mobVs: MOB_VS,
  mobFs: MOB_FS,
};
