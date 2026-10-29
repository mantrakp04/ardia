chrome.runtime.sendMessage({ kind: "panel", href: location.href, tabViews: chrome.extension.getViews({ type: "tab" }).length });
