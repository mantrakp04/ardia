import { fixesFilm } from "../../lib/fixes-film/Film";
import segments from "./segments.json";

const film = fixesFilm({ id: "fixes-0246n6", release: "0.2.46-nightly.6", before: "0.2.46-nightly.5", channel: "nightly", segments });

export const meta = film.meta;
export default film.Video;
