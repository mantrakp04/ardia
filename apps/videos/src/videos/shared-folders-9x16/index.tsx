import { Film, meta as metaFor } from "../../lib/sf-film/Film";
import document from "./studio.json";

export const meta = metaFor("film", 1080, 1920);

export default function Video() {
  return <Film cut="film" document={document} score="shared-folders-9x16" />;
}
