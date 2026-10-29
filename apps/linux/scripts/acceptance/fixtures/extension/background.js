globalThis.fixtureReports = [];
chrome.runtime.onMessage.addListener((message) => {
  globalThis.fixtureReports.push(message);
});
chrome.omnibox.onInputEntered.addListener(() => {});
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL("opened.html#clicked") }));
