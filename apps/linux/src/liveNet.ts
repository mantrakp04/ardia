export const isMocked = false;

export const endpoints = {
  githubGraphql: "https://api.github.com/graphql",
  githubWeb: "https://github.com",
  bitbucket: "https://api.bitbucket.org/2.0",
  notion: "https://api.notion.com/v1",
  confluence: (site: string) => site.replace(/\/$/, ""),
  googleAuth: "https://accounts.google.com/o/oauth2/v2/auth",
  googleToken: "https://oauth2.googleapis.com/token",
  drive: "https://www.googleapis.com/drive/v3",
};

export const form = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
