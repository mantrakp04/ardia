export function parseHex(hex) {
  const value = hex.replace(/^#/, "");
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
}

export function toHex(color) {
  return `#${color.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

export function clampRect(image, rect) {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const right = Math.min(image.width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(image.height, Math.ceil(rect.y + rect.height));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

export function pixel(image, x, y) {
  const i = (y * image.width + x) * 3;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}

export function colorDistance(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

export function meanColor(image, rect) {
  const r = clampRect(image, rect);
  const sum = [0, 0, 0];
  let count = 0;
  for (let y = r.y; y < r.y + r.height; y++) {
    for (let x = r.x; x < r.x + r.width; x++) {
      const p = pixel(image, x, y);
      sum[0] += p[0];
      sum[1] += p[1];
      sum[2] += p[2];
      count++;
    }
  }
  return count ? sum.map((v) => v / count) : null;
}

export function fractionNear(image, rect, color, tolerance = 24) {
  const r = clampRect(image, rect);
  let near = 0;
  let count = 0;
  for (let y = r.y; y < r.y + r.height; y++) {
    for (let x = r.x; x < r.x + r.width; x++) {
      count++;
      if (colorDistance(pixel(image, x, y), color) <= tolerance) near++;
    }
  }
  return count ? near / count : 0;
}

export function differingFraction(before, after, rect, threshold = 24) {
  const r = clampRect(before, rect);
  let changed = 0;
  let count = 0;
  for (let y = r.y; y < r.y + r.height; y++) {
    for (let x = r.x; x < r.x + r.width; x++) {
      count++;
      if (colorDistance(pixel(before, x, y), pixel(after, x, y)) > threshold) changed++;
    }
  }
  return count ? changed / count : 0;
}

export function hueOf([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 1) return null;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

export function saturationOf([r, g, b]) {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

export function hueDistance(a, b) {
  if (a === null || b === null) return 180;
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function towards(base, target, sample) {
  const full = colorDistance(base, target);
  if (!full) return 0;
  const along = [0, 1, 2].reduce((sum, i) => sum + (sample[i] - base[i]) * (target[i] - base[i]), 0);
  const length = [0, 1, 2].reduce((sum, i) => sum + (target[i] - base[i]) ** 2, 0);
  return along / length;
}
