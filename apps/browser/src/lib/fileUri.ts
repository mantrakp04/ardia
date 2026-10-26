export function fileUri(path: string): string {
  return `file://${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function pathFromPicked(picked: string): string {
  if (!/^file:\/\//i.test(picked)) return picked;
  try {
    return decodeURIComponent(new URL(picked).pathname);
  } catch {
    return "";
  }
}
