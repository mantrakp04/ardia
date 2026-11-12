let remote = 0;

export function fromSync<T>(apply: () => T): T {
  remote++;
  try {
    return apply();
  } finally {
    remote--;
  }
}

export const writingFromSync = () => remote > 0;
