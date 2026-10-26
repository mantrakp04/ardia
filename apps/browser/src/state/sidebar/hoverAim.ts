export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type CardReach = "covered" | "aiming" | "away";

export const pointInRect = (r: Rect, p: Point) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
const side = (a: Point, b: Point, p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

export function cardReach(card: Rect, from: Point | null, p: Point): CardReach {
  if (pointInRect(card, p)) return "covered";
  if (!from || pointInRect(card, from)) return "away";
  const rightward = from.x <= card.x;
  const near = rightward ? card.x : card.x + card.width;
  if (rightward ? p.x < from.x : p.x > from.x) return "away";
  const top = { x: near, y: card.y };
  const bottom = { x: near, y: card.y + card.height };
  const a = side(from, top, p);
  const b = side(top, bottom, p);
  const c = side(bottom, from, p);
  return (a < 0 || b < 0 || c < 0) && (a > 0 || b > 0 || c > 0) ? "away" : "aiming";
}
