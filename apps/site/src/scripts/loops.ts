const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
const videos = [...document.querySelectorAll<HTMLVideoElement>("video[data-loop]")];

function load(video: HTMLVideoElement) {
  if (video.dataset.loaded) return;
  video.dataset.loaded = "1";
  video.muted = true;
  if (video.dataset.poster) video.poster = video.dataset.poster;
  for (const source of video.querySelectorAll<HTMLSourceElement>("source[data-src]")) source.src = source.dataset.src ?? "";
  video.load();
}

if (videos.length && !saveData && "IntersectionObserver" in window) {
  const seen = new IntersectionObserver(
    (entries) => {
      for (const { target, isIntersecting } of entries) {
        const video = target as HTMLVideoElement;
        if (isIntersecting && !reduced.matches) {
          load(video);
          video.play()?.catch(() => {});
        } else video.pause();
      }
    },
    { rootMargin: "200px 0px" },
  );
  for (const video of videos) seen.observe(video);
  reduced.addEventListener("change", () => {
    if (reduced.matches) for (const video of videos) video.pause();
    else
      for (const video of videos) {
        seen.unobserve(video);
        seen.observe(video);
      }
  });
}
