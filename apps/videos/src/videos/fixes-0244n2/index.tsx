import { fixesFilm } from "../../lib/fixes-film/Film";
import segments from "./segments.json";

const film = fixesFilm({ id: "fixes-0244n2", release: "0.2.44-nightly.2", before: "0.2.44-nightly.1", channel: "nightly", segments });

export const meta = film.meta;
export default film.Video;
