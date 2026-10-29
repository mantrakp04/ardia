const HOST = "dev.ardia.acceptance.vault";
const status = document.getElementById("status");
const fill = document.getElementById("fill");
const result = document.getElementById("result");

function ask(message) {
  return chrome.runtime.sendNativeMessage(HOST, message);
}

async function connect() {
  try {
    const reply = await ask({ command: "hello" });
    status.textContent = `Connected to ${reply.app}`;
    fill.disabled = false;
  } catch (error) {
    status.textContent = `Desktop app not connected: ${error?.message ?? error}`;
  }
}

fill.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const origin = new URL(tab.url).origin;
  const login = await ask({ command: "login", origin });
  if (!login?.username) {
    result.textContent = `No login for ${origin}`;
    return;
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [login.username, login.password],
    func: (username, password) => {
      const user = document.querySelector("input[type=email], input[name=username], input[type=text]");
      const secret = document.querySelector("input[type=password]");
      for (const [field, value] of [[user, username], [secret, password]]) {
        if (!field) continue;
        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
  });
  result.textContent = `Filled ${login.username}`;
});

connect();
