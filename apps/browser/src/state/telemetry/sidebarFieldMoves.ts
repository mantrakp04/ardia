let moves = 0;

export const noteSidebarFieldMoved = () => void moves++;

export function takeSidebarFieldMoves() {
  const taken = moves;
  moves = 0;
  return taken;
}
