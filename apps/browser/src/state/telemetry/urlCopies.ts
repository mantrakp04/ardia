let copies = 0;
let whilePending = 0;
let selectionCopies = 0;
let selectionCopyTabs = 0;
let selectionCopiesAsMarkdown = 0;

export function noteUrlCopied(firstPagePending: boolean) {
  copies++;
  if (firstPagePending) whilePending++;
}

export function noteSelectionCopiedByKey(tabs: number, markdown: boolean) {
  selectionCopies++;
  selectionCopyTabs += tabs;
  if (markdown) selectionCopiesAsMarkdown++;
}

export function takeUrlCopyCounts() {
  const taken = {
    url_copies: copies,
    url_copies_while_pending: whilePending,
    selection_copy_keys: selectionCopies,
    selection_copy_key_tabs: selectionCopyTabs,
    selection_copy_markdown: selectionCopiesAsMarkdown,
  };
  copies = 0;
  whilePending = 0;
  selectionCopies = 0;
  selectionCopyTabs = 0;
  selectionCopiesAsMarkdown = 0;
  return taken;
}
