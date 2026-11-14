export function displayHost(host: string, url: string): string {
  const bare = host.replace(/^www\./i, "");
  return bare || url;
}
