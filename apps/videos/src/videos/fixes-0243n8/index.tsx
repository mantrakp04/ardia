import { fixesFilm } from "../../lib/fixes-film/Film";
import segments from "./segments.json";

const film = fixesFilm({ id: "fixes-0243n8", release: "0.2.43-nightly.8", before: "0.2.43-nightly.7", channel: "nightly", segments });

export const meta = film.meta;
export default film.Video;
