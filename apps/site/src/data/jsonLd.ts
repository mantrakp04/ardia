import { MIN_MACOS, VERSION } from "./release";

export const breadcrumbs = (home: string, ...crumbs: [name: string, url: string][]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [["Ardia", home], ...crumbs].map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })),
});

export const aboutArdiaPage = ({ home, url, title, description }: { home: string; url: string; title: string; description: string }) => ({
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: title,
  description,
  url,
  isPartOf: { "@type": "WebSite", name: "Ardia", url: home },
  about: {
    "@type": "SoftwareApplication",
    name: "Ardia",
    applicationCategory: "BrowserApplication",
    operatingSystem: `${MIN_MACOS} or later, Apple Silicon`,
    softwareVersion: VERSION,
    url: home,
  },
});
