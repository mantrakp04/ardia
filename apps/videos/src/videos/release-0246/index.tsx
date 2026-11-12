import { fixesFilm } from "../../lib/fixes-film/Film";
import segments from "./segments.json";

const film = fixesFilm({ id: "release-0246", release: "0.2.46", before: "0.2.45", channel: "stable", segments });

export const meta = film.meta;
export default film.Video;
