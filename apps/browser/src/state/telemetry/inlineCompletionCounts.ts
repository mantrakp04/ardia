let shown = 0;

export const noteInlineCompletionShown = () => void (shown += 1);

export function takeInlineCompletionCounts() {
  const taken = { command_bar_inline_completions: shown };
  shown = 0;
  return taken;
}
