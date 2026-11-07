import { Composition, registerRoot } from "remotion";
import * as hero from "../videos/shared-folders-16x9";
import * as novo from "../videos/shared-folders-16x9-novo";
import * as portrait from "../videos/shared-folders-9x16";

const FILMS = { "shared-folders-16x9": hero, "shared-folders-9x16": portrait, "shared-folders-16x9-novo": novo };

function Films() {
  return (
    <>
      {Object.entries(FILMS).map(([id, film]) => (
        <Composition key={id} id={id} component={film.default} {...film.meta} />
      ))}
    </>
  );
}

registerRoot(Films);
