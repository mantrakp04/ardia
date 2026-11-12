let bookmarkExports = 0;
let passwordExports = 0;
let unpackedInstalls = 0;

export const noteBookmarkExport = () => void (bookmarkExports += 1);
export const notePasswordExport = () => void (passwordExports += 1);
export const noteUnpackedInstall = () => void (unpackedInstalls += 1);

export function takeExportCounts() {
  const taken = { bookmark_html_exports: bookmarkExports, password_exports: passwordExports, unpacked_extension_installs: unpackedInstalls };
  bookmarkExports = 0;
  passwordExports = 0;
  unpackedInstalls = 0;
  return taken;
}
