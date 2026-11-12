import { fixesFilm } from "../../lib/fixes-film/Film";
import segments from "./segments.json";

const film = fixesFilm({ id: "fixes-0243", release: "0.2.43", before: "0.2.42", channel: "stable", segments });

export const meta = film.meta;
export default film.Video;
