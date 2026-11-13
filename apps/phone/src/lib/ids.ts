const HEX = "0123456789ABCDEF";

export function newUuid(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      out += "-";
    } else if (i === 14) {
      out += "4";
    } else if (i === 19) {
      out += HEX[8 + Math.floor(random() * 4)];
    } else {
      out += HEX[Math.floor(random() * 16)];
    }
  }
  return out;
}
