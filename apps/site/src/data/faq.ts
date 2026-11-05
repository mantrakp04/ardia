export type Question = { id?: string; question: string; answer: string; more?: { path: string; label: string } };

export const FAQ: Question[] = [
  { question: "What does it cost?", answer: "Nothing. It’s open source under GPL-3.0. No paid tier, no catch." },
  {
    id: "install",
    question: "Is it safe to open?",
    answer: "Signed and notarized by Apple, so macOS opens it without a fuss. The source is on GitHub if you’d rather check yourself.",
  },
  {
    question: "What does it collect?",
    answer:
      "Once a day the app sends one anonymous “opened today” count with its version and macOS version and no persistent ID, so we know how many people use it. Update checks are counted by version and day, and whether it’s a new copy’s first. Each launch also reads one small file, the same for everyone, so we can switch off a speed-up that misbehaves. Nothing else, unless you tick the box. Then crash reports and counts, never your sites or searches.",
  },
  {
    question: "And this website?",
    answer: "It counts its own visitors on its own servers, replays included, typing masked, gone after 30 days. No third party does the counting.",
  },
  {
    question: "Coming from Arc?",
    answer: "Same sidebar, same muscle memory. The importer brings your spaces, pinned tabs and their names along.",
    more: { path: "arc/", label: "See what comes over." },
  },
  { question: "Is this Dia?", answer: "No. It dresses like Dia, or like Arc if you ask." },
  { question: "Why “Ardia”?", answer: "Arc plus Dia." },
];

export const faqJsonLd = () => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((q) => ({ "@type": "Question", name: q.question, acceptedAnswer: { "@type": "Answer", text: q.answer } })),
});
