import credits from "./credits.json";

export type LibraryCredit = { name: string; detail: string; license: string; url: string };

export const LIBRARY_CREDITS: LibraryCredit[] = [
  ...credits.native.map((library) => ({ name: library.name, detail: library.artifacts.join(", "), license: library.license, url: library.url })),
  ...credits.packages.map((pkg) => ({ name: pkg.name, detail: pkg.version, license: pkg.license, url: pkg.url })),
];
