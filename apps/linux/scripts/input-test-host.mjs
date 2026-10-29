export const ardiaHost = {
  bootstrap: { windowId: "shortcut-fixture" },
  calls: [],
  listeners: [],
  async invoke(method, payload) { this.calls.push({ method, payload }); },
  onEvent(listener) { this.listeners.push(listener); return () => {}; },
};
export const reportHostError = (error) => { throw error; };

export const hostSupports = () => false;
export const hostModuleMethod = (module, method, host = ardiaHost) => (...args) => host.invoke(`${module}.${method}`, { args });
export const callHost = (name) => Promise.reject(new Error(`Unexpected engine call in input fixture: ${name}`));
