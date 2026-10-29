const systemRegion = Intl.DateTimeFormat().resolvedOptions().locale.split("-").slice(1).find((part) => /^([A-Z]{2}|\d{3})$/.test(part));

export const UI_LOCALE = systemRegion ? `en-${systemRegion}` : "en-US";
