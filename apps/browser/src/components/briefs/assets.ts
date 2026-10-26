import type { ImageSourcePropType } from "react-native";
import { parseBriefDate } from "../../lib/briefDates";

export type BriefArtwork = { source: ImageSourcePropType; width: number; height: number; title: string; artist: string; year: string };

export function briefDate(date?: string): Date {
  return (date ? parseBriefDate(date) : null) ?? new Date();
}

export function briefTitleForDate(date?: string): string {
  const day = briefDate(date);
  return `The ${day.toLocaleDateString("en-US", { weekday: "long" })} Brief - ${day.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`;
}

const ARTWORKS: BriefArtwork[] = [
  { source: require("../../../assets/briefs/saturn-from-titan.jpg"), width: 2000, height: 1567, title: "Saturn as Seen from Titan", artist: "Chesley Bonestell", year: "1944" },
  { source: require("../../../assets/briefs/aurora-borealis.jpg"), width: 2000, height: 1345, title: "Aurora Borealis", artist: "Frederic Edwin Church", year: "1865" },
  { source: require("../../../assets/briefs/wanderer.jpg"), width: 2000, height: 1500, title: "Wanderer above the Sea of Fog", artist: "Caspar David Friedrich", year: "1818" },
  { source: require("../../../assets/briefs/mount-corcoran.jpg"), width: 2000, height: 1257, title: "Mount Corcoran", artist: "Albert Bierstadt", year: "c. 1876–1877" },
  { source: require("../../../assets/briefs/shawangunk-mountains.jpg"), width: 2000, height: 1262, title: "The Shawangunk Mountains", artist: "Sanford Robinson Gifford", year: "1864" },
  { source: require("../../../assets/briefs/sunset-in-the-woods.jpg"), width: 2000, height: 1335, title: "Sunset in the Woods", artist: "George Inness", year: "1891" },
  { source: require("../../../assets/briefs/grand-canyon-yellowstone.jpg"), width: 2000, height: 1143, title: "The Grand Canyon of the Yellowstone", artist: "Thomas Moran", year: "1872" },
];

export function briefArtworkForDate(date?: string): BriefArtwork {
  return ARTWORKS[briefDate(date).getDay()]!;
}
