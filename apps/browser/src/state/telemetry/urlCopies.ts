let copies = 0;
let whilePending = 0;

export function noteUrlCopied(firstPagePending: boolean) {
  copies++;
  if (firstPagePending) whilePending++;
}

export function takeUrlCopyCounts() {
  const taken = { url_copies: copies, url_copies_while_pending: whilePending };
  copies = 0;
  whilePending = 0;
  return taken;
}
