export const isWebDemo: boolean = true;

export const APP_DOWNLOAD_EVENT = "ardia-demo:download";

export const requestAppDownload = (): void => {
  window.dispatchEvent(new Event(APP_DOWNLOAD_EVENT));
};
