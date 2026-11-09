import { Film, meta as metaFor } from "../../lib/sf-film/Film";
import document from "../shared-folders-16x9/studio.json";

export const meta = metaFor("film", 1920, 1080);

export default function Video() {
  return <Film cut="film" document={document} score="shared-folders-16x9-novo" />;
}
