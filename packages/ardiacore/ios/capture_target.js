(pointX, pointY, backing) => {
  const MEDIA = new Set(["IMG", "PICTURE", "VIDEO", "CANVAS", "SVG", "svg", "OBJECT", "EMBED"]);
  const REPLACED = new Set([...MEDIA, "IFRAME", "INPUT", "TEXTAREA", "SELECT", "BUTTON"]);
  const SMALLEST = 24;
  const MOST = 12;
  const visual = window.visualViewport;
  const zoom = visual ? visual.scale : 1;
  const shiftX = visual ? visual.offsetLeft : 0;
  const shiftY = visual ? visual.offsetTop : 0;
  const shownWidth = visual ? visual.width : window.innerWidth;
  const shownHeight = visual ? visual.height : window.innerHeight;
  const pointsPerPixel = (window.devicePixelRatio / backing) * zoom;
  const viewWidth = shownWidth * pointsPerPixel;
  const viewHeight = shownHeight * pointsPerPixel;
  const clientX = pointX / pointsPerPixel + shiftX;
  const clientY = pointY / pointsPerPixel + shiftY;

  const stackAt = (root, x, y, offsetX, offsetY, depth) => {
    const found = [];
    for (const element of root.elementsFromPoint(x, y)) {
      if (depth < 4 && element.shadowRoot) {
        for (const inner of stackAt(element.shadowRoot, x, y, offsetX, offsetY, depth + 1)) {
          if (inner.element !== element && inner.element.getRootNode && inner.element.getRootNode() === element.shadowRoot) found.push(inner);
        }
      }
      if (depth < 4 && element.tagName === "IFRAME") {
        try {
          const inside = element.contentDocument;
          if (inside) {
            const frame = element.getBoundingClientRect();
            const left = frame.left + element.clientLeft;
            const top = frame.top + element.clientTop;
            found.push(...stackAt(inside, x - left, y - top, offsetX + left, offsetY + top, depth + 1));
          }
        } catch (e) {}
      }
      found.push({ element, offsetX, offsetY });
    }
    return found;
  };

  const viewRect = (rect, offsetX, offsetY) => {
    const left = Math.max(0, (rect.left + offsetX - shiftX) * pointsPerPixel);
    const top = Math.max(0, (rect.top + offsetY - shiftY) * pointsPerPixel);
    const right = Math.min(viewWidth, (rect.right + offsetX - shiftX) * pointsPerPixel);
    const bottom = Math.min(viewHeight, (rect.bottom + offsetY - shiftY) * pointsPerPixel);
    return { x: left, y: top, width: right - left, height: bottom - top };
  };

  const score = (element, rect, shown) => {
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.opacity === "0") return null;
    if (style.display === "inline" && !REPLACED.has(element.tagName)) return null;
    if (shown.width < SMALLEST || shown.height < SMALLEST) return null;
    if (shown.width >= viewWidth - 1 && shown.height >= viewHeight - 1) return null;
    let points = 0;
    if (Math.min(rect.width, rect.height) < 100) points -= 5;
    if (rect.width >= shownWidth) points -= 5;
    if (rect.height >= shownHeight) points -= 5;
    if (rect.width * rect.height > shownWidth * shownHeight * 0.7) points -= 5;
    if (MEDIA.has(element.tagName) || (style.backgroundImage && style.backgroundImage.startsWith("url("))) points += 5;
    points += (rect.width + rect.height) / 2 / 500;
    return points;
  };

  const candidates = [];
  let best = -1;
  let bestPoints = 0;
  for (const { element, offsetX, offsetY } of stackAt(document, clientX, clientY, 0, 0, 0)) {
    if (candidates.length >= MOST) break;
    const rect = element.getBoundingClientRect();
    const shown = viewRect(rect, offsetX, offsetY);
    const points = score(element, rect, shown);
    if (points === null) continue;
    const box = [shown.x, shown.y, shown.width, shown.height].map((value) => Math.round(value * 2) / 2);
    const last = candidates[candidates.length - 1];
    if (last && last.every((value, index) => Math.abs(value - box[index]) < 1)) {
      if (points >= 0 && (best < 0 || points > bestPoints)) {
        best = candidates.length - 1;
        bestPoints = points;
      }
      continue;
    }
    candidates.push(box);
    if (points >= 0 && (best < 0 || points > bestPoints)) {
      best = candidates.length - 1;
      bestPoints = points;
    }
  }
  post("result", JSON.stringify({ candidates, best }));
}
