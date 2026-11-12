export const SETTINGS_SINCE = "0.2.43-nightly.8";
export const TINT_KEY = "glassTintAmount";
export const TINT_SWITCH_KEY = "glassTintWithTheme";
export const NULL_VALUE = "null";
export const OTHER_VALUE = "__other__";

export const settingValueLabel = (value: string) => (value === OTHER_VALUE ? "Other" : value === NULL_VALUE ? "not set" : value);
