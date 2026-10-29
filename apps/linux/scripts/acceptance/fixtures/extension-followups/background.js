globalThis.commandReports = [];
globalThis.popupReports = [];
chrome.commands.onCommand.addListener((command, tab) => {
  globalThis.commandReports.push({ command, tabId: tab?.id ?? null });
});
chrome.runtime.onMessage.addListener((message) => {
  globalThis.popupReports.push(message);
});
