import type { ImageSourcePropType } from "react-native";
import { fileUri } from "./fileUri";

export type Artwork = { id: string; title: string; artist: string; source: ImageSourcePropType };

export const ARTWORKS: Artwork[] = [
  { id: "starry-night", title: "The Starry Night", artist: "Vincent van Gogh", source: require("../../assets/artwork/van-gogh-starry-night.jpg") },
  { id: "wheat-field", title: "Wheat Field with Cypresses", artist: "Vincent van Gogh", source: require("../../assets/artwork/van-gogh-wheat-field.jpg") },
  { id: "impression-sunrise", title: "Impression, Sunrise", artist: "Claude Monet", source: require("../../assets/artwork/monet-impression-sunrise.jpg") },
  { id: "great-wave", title: "The Great Wave off Kanagawa", artist: "Katsushika Hokusai", source: require("../../assets/artwork/hokusai-great-wave.jpg") },
  { id: "grande-jatte", title: "A Sunday on La Grande Jatte", artist: "Georges Seurat", source: require("../../assets/artwork/seurat-grande-jatte.jpg") },
  { id: "paris-street", title: "Paris Street; Rainy Day", artist: "Gustave Caillebotte", source: require("../../assets/artwork/caillebotte-paris-street.jpg") },
];

export function ntpBackgroundSource(background: string, customPath: string): ImageSourcePropType | null {
  if (background === "custom") return customPath ? { uri: fileUri(customPath) } : null;
  return ARTWORKS.find((a) => a.id === background)?.source ?? null;
}

