document.getElementById("close").addEventListener("click", () => window.close());
chrome.runtime.sendMessage({ kind: "popup", href: location.href, popupViews: chrome.extension.getViews({ type: "popup" }).length });
