import { fixesFilm } from "../../lib/fixes-film/Film";
import segments from "./segments.json";

const film = fixesFilm({ id: "fixes-0244n4", release: "0.2.44-nightly.4", before: "0.2.44-nightly.3", channel: "nightly", segments });

export const meta = film.meta;
export default film.Video;
