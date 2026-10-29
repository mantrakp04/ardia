globalThis.fixtureReports = [];
chrome.runtime.onMessage.addListener((message) => {
  globalThis.fixtureReports.push(message);
});
chrome.omnibox.onInputEntered.addListener(() => {});
