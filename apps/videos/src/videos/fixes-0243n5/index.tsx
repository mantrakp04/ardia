import { fixesFilm } from "../../lib/fixes-film/Film";
import segments from "./segments.json";

const film = fixesFilm({ id: "fixes-0243n5", release: "0.2.43-nightly.5", before: "0.2.43-nightly.4", channel: "nightly", segments });

export const meta = film.meta;
export default film.Video;
