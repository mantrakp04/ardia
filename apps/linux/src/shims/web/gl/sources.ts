export const fullscreenVertex = `#version 300 es
const vec2 positions[4] = vec2[4](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0));
void main() {
  gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
}
`;

const prelude = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 pixelSize;
out vec4 fragColor;
vec2 stageUV() {
  return vec2(gl_FragCoord.x / pixelSize.x, 1.0 - gl_FragCoord.y / pixelSize.y);
}
float metalFmod(float x, float y) {
  return x - y * trunc(x / y);
}
`;

export const backdropFragment = `${prelude}
uniform vec4 labA;
uniform vec4 labB;
uniform vec2 viewSize;
uniform vec2 direction;
uniform float grainOpacity;
uniform float grainScale;

vec3 oklabToSRGB(vec3 lab) {
  vec3 lms = vec3(dot(lab, vec3(1.0, 0.3963377774, 0.2158037573)),
                  dot(lab, vec3(1.0, -0.1055613458, -0.0638541728)),
                  dot(lab, vec3(1.0, -0.0894841775, -1.2914855480)));
  lms = lms * lms * lms;
  vec3 lin = vec3(dot(lms, vec3(4.0767416621, -3.3077115913, 0.2309699292)),
                  dot(lms, vec3(-1.2684380046, 2.6097574011, -0.3413193965)),
                  dot(lms, vec3(-0.0041960863, -0.7034186147, 1.7076147010)));
  vec3 a = abs(lin);
  vec3 encoded = sign(lin) * (1.055 * pow(a, vec3(1.0 / 2.4)) - 0.055);
  return mix(encoded, lin * 12.92, lessThanEqual(a, vec3(0.0031308)));
}

float grainHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = stageUV();
  float t = clamp(dot(uv - 0.5, direction) + 0.5, 0.0, 1.0);
  vec4 lab = mix(labA, labB, t);
  vec3 base = oklabToSRGB(lab.xyz);
  vec2 cell = floor(uv * viewSize / max(grainScale, 0.25));
  float g = grainHash(cell);
  vec3 rgb = clamp(base * (1.0 - grainOpacity * (1.0 - g)), 0.0, 1.0);
  fragColor = vec4(rgb * lab.w, lab.w);
}
`;

export const haloFragment = `${prelude}
uniform vec2 resolution;
uniform int direction;
uniform vec4 colors[2];
uniform bool isDark;
uniform float time;
uniform float speed;
uniform float delay;
uniform float fadeOutStart;
uniform float fadeOutDuration;
uniform float inset;
uniform float cornerRadius;

vec3 haloHash33(vec3 p) {
  vec3 p3 = fract(p * vec3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0 * fract((p3.xxy + p3.yzz) * p3.zyx);
}

float haloNoise(vec3 p) {
  const float F3 = 0.333333343, G3 = 0.166666672;
  vec3 s = floor(p + (p.x + p.y + p.z) * F3);
  vec3 x = p - s + (s.x + s.y + s.z) * G3;
  vec3 e = step(vec3(0.0), x - x.yzx);
  vec3 i1 = e * (1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy * (1.0 - e);
  vec3 x1 = x - i1 + G3;
  vec3 x2 = x - i2 + 2.0 * G3;
  vec3 x3 = x - 0.5;
  vec4 w = max(0.6 - vec4(dot(x, x), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  w = pow(w, vec4(4.0));
  vec4 d = vec4(dot(x, haloHash33(s)), dot(x1, haloHash33(s + i1)),
                dot(x2, haloHash33(s + i2)), dot(x3, haloHash33(s + 1.0)));
  return dot(vec4(31.316), d * w);
}

void main() {
  vec2 uv = stageUV();
  float aspect = resolution.x / resolution.y;
  vec2 p = (uv - 0.5) * 2.0;
  p.x *= aspect;
  float inset2 = inset * 2.0;
  float hx = 1.0 - inset2 / resolution.x;
  float hy = 1.0 - inset2 / resolution.y;
  vec2 halfSize = aspect > 1.0 ? vec2(hx * aspect, hy) : vec2(hx, hy / aspect);
  float r = cornerRadius / min(resolution.x - inset2, resolution.y - inset2);
  float dist = abs(length(max(abs(p) - halfSize + r, 0.0)) - r);

  float t = speed * 0.8 * time - delay;
  float sweep = (t == 1.0) ? 1.25 : (1.0 - pow(2.0, -10.0 * t)) * 1.25;
  vec2 n = p / halfSize;
  float angle = atan(n.y, n.x);
  if (angle < 0.0) angle += 6.28318548;
  float offset = direction == 1 ? 1.57079637 : direction == 2 ? 3.14159274 : direction == 3 ? 4.71238899 : 0.0;
  float around = metalFmod(1.25 - metalFmod(offset + angle, 6.28318548) * 0.159154937, 1.0);
  if (around > 0.5) around = 1.0 - around;
  around *= 2.0;
  float arc = smoothstep(0.0, 1.0, clamp((abs(around - sweep) - 0.22) * -4.54545450, 0.0, 1.0));

  float line = smoothstep(0.0, 1.0, clamp((dist - 0.025) * -40.0, 0.0, 1.0)) * arc * (isDark ? 0.4 : 1.0);

  float nz = haloNoise(vec3(p * 0.5, time)) + 0.5;
  float glowWidth = mix(0.1, 0.2, nz);
  float shrink = (1.0 - t) * 0.95;
  float g1 = shrink == 0.0 ? 0.0 : clamp((dist - shrink) / -shrink, 0.0, 1.0);
  float g2 = clamp((dist - glowWidth) / -glowWidth, 0.0, 1.0);
  float g = g1 * g2;
  float glow = g * g * (isDark ? 0.1 : 0.12) * arc * (3.0 - 2.0 * g1) * (3.0 - 2.0 * g2);

  float alpha = mix(colors[0].a, colors[1].a, nz) * clamp(glow + line, 0.0, 1.0);
  if (t > fadeOutStart) {
    alpha *= 1.0 - clamp((t - fadeOutStart) / fadeOutDuration, 0.0, 1.0);
  }
  vec3 rgb = clamp(mix(colors[0].rgb, colors[1].rgb, nz) + line, 0.0, 1.0);
  fragColor = vec4(rgb * alpha, alpha);
}
`;

export const MAX_POWER_UP_COLORS = 16;

export const powerUpFragment = `${prelude}
uniform int direction;
uniform int numberOfColors;
uniform vec4 colors[${MAX_POWER_UP_COLORS}];
uniform float time;
uniform float speed;
uniform float delay;
uniform float fadeOutStart;
uniform float fadeOutDuration;
uniform float origin;

float easeOutExpo(float t) {
  return (t == 1.0) ? 1.0 : 1.0 - pow(2.0, -10.0 * t);
}

float easeInOutQuart(float t) {
  return (t < 0.5) ? 8.0 * t * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 4.0) * 0.5;
}

float shiftCenter(float v, float o) {
  float mid = 1.0 - o;
  return (v <= 0.5) ? v * 2.0 * mid : mid + o * 2.0 * (v - 0.5);
}

vec3 oklabToLinearSRGB(vec3 lab) {
  vec3 lms = vec3(dot(lab, vec3(1.0, 0.396337777, 0.215803757)),
                  dot(lab, vec3(1.0, -0.105561346, -0.0638541728)),
                  dot(lab, vec3(1.0, -0.0894841775, -1.29148555)));
  lms = pow(lms, vec3(3.0));
  return vec3(dot(lms, vec3(4.0767417, -3.3077116, 0.230969936)),
              dot(lms, vec3(-1.26843798, 2.60975742, -0.341319382)),
              dot(lms, vec3(-0.00419608643, -0.703418612, 1.70761466)));
}

float linearToSRGB(float c) {
  float ac = abs(c);
  if (ac <= 0.00313080009) {
    return c * 12.9200001;
  }
  return sign(c) * (pow(ac, 0.416666657) * 1.05499995 - 0.0549999997);
}

vec4 samplePalette(int n1, float v) {
  float f = float(n1) * v;
  int i = int(floor(f));
  vec4 a = colors[i];
  vec4 b = colors[min(i + 1, n1)];
  return mix(a, b, smoothstep(0.0, 1.0, f - float(i)));
}

float mask(vec2 uv, float width, float start, float end, float skew, int direction) {
  float left, right, top, bottom;
  if (direction == 0 || direction == 2) {
    float k = (uv.y - 0.5) * skew;
    left = smoothstep(0.0, width, uv.x + k);
    right = 1.0 - smoothstep(1.0 - width, 1.0, uv.x - k);
    if (direction == 0) {
      top = smoothstep(0.0, start, uv.y);
      bottom = 1.0 - smoothstep(1.0 - end, 1.0, uv.y);
    } else {
      top = 1.0 - smoothstep(1.0 - end, 1.0, 1.0 - uv.y);
      bottom = smoothstep(0.0, start, 1.0 - uv.y);
    }
  } else {
    float k = (uv.x - 0.5) * skew;
    top = smoothstep(0.0, width, uv.y + k);
    bottom = 1.0 - smoothstep(1.0 - width, 1.0, uv.y - k);
    if (direction == 1) {
      left = 1.0 - smoothstep(1.0 - end, 1.0, 1.0 - uv.x);
      right = smoothstep(0.0, start, 1.0 - uv.x);
    } else {
      left = smoothstep(0.0, start, uv.x);
      right = 1.0 - smoothstep(1.0 - end, 1.0, uv.x);
    }
  }
  return left * right * top * bottom;
}

vec4 gradient(vec2 uv, int numberOfColors, float progress, int direction) {
  float c = (direction == 0 || direction == 2) ? uv.x : uv.y;
  float p;
  if (c >= 0.200000003 && c < 0.400000006) {
    p = progress - 0.0250000004;
  } else if (c >= 0.400000006 && c < 0.600000024) {
    p = progress - 0.0500000007;
  } else {
    p = (c >= 0.600000024 && c < 0.800000012) ? progress - 0.0250000004 : progress;
  }
  p = clamp(p, 0.0, 1.0);

  float head = 1.0 - easeInOutQuart(p) * 0.949999988;

  float crossPos, alongPos;
  if (direction == 0) {
    crossPos = uv.x; alongPos = uv.y;
  } else if (direction == 2) {
    crossPos = uv.x; alongPos = 1.0 - uv.y;
  } else if (direction == 1) {
    crossPos = uv.y; alongPos = 1.0 - uv.x;
  } else {
    crossPos = uv.y; alongPos = uv.x;
  }
  float along = alongPos * 0.400000006;
  float bend = (1.0 - pow(abs(crossPos - 0.5) + 0.5, 5.0)) * -0.0500000007;

  int n1 = numberOfColors - 1;
  bool past = along > head;
  float v = past ? 1.0 : max(bend + along / head, 0.0);
  vec4 col = samplePalette(n1, v);
  col.a *= p * 0.5 + 0.5;

  if (past) {
    vec4 trail = samplePalette(n1, max(bend + along, 0.0));
    trail.a *= p * 0.5;
    float edge = easeOutExpo(1.0 - p) * 0.0500000007;
    col = mix(col, trail, clamp((along - head) / edge, 0.0, 1.0));
  }

  vec3 lin = oklabToLinearSRGB(col.rgb);
  return vec4(linearToSRGB(lin.r), linearToSRGB(lin.g), linearToSRGB(lin.b), col.a * 0.100000001);
}

void main() {
  if (direction < 0 || direction >= 4) {
    fragColor = vec4(0.0);
    return;
  }
  vec2 tex = stageUV();
  float o = mix(origin, 0.5, clamp(time * 1.5, 0.0, 1.0));
  vec2 uv;
  if (direction == 0) {
    uv = vec2(shiftCenter(tex.x, o), clamp((tex.y - 0.200000003) * 1.25, 0.0, 1.0));
  } else if (direction == 2) {
    uv = vec2(shiftCenter(tex.x, o), 1.0 - clamp((0.800000012 - tex.y) * 1.25, 0.0, 1.0));
  } else if (direction == 1) {
    uv = vec2(clamp((0.800000012 - tex.x) * 1.25, 0.0, 1.0), shiftCenter(tex.y, o));
  } else {
    uv = vec2(1.0 - clamp((tex.x - 0.200000003) * 1.25, 0.0, 1.0), shiftCenter(tex.y, o));
  }

  float t = time * 0.75 * speed + 0.449999988 - delay;

  vec4 col = gradient(uv, numberOfColors, t, direction);
  float m = mask(uv, 0.449999988, 0.200000003, 0.150000006, 0.25, direction);
  col.a = col.a * m * clamp(time * 10.0, 0.0, 1.0);

  if (t > fadeOutStart) {
    col.a *= 1.0 - clamp((t - fadeOutStart) / fadeOutDuration, 0.0, 1.0);
  }
  fragColor = vec4(col.rgb * col.a, col.a);
}
`;
