import { REPO_SLUG } from "./release";

const MIN_SHOWN = 100;

async function fetchStars(): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO_SLUG}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "ardia-site-build" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const { stargazers_count } = (await res.json()) as { stargazers_count?: unknown };
    return typeof stargazers_count === "number" ? stargazers_count : null;
  } catch {
    return null;
  }
}

const stars = await fetchStars();

export const STARS: string | null =
  stars === null || stars < MIN_SHOWN
    ? null
    : stars >= 1000
      ? `${(stars / 1000).toFixed(stars >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`
      : String(stars);
