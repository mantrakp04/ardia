function hex(n: number) {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
function variant() {
  return (8 + Math.floor(Math.random() * 4)).toString(16);
}

export function uuidv4() {
  const h = hex(29);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(12, 15)}-${variant()}${h.slice(15, 18)}-${h.slice(18, 29)}${hex(1)}`;
}

export function uuidv7() {
  const ms = Date.now().toString(16).padStart(12, "0");
  const h = hex(18);
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7${h.slice(0, 3)}-${variant()}${h.slice(3, 6)}-${h.slice(6, 18)}`;
}
