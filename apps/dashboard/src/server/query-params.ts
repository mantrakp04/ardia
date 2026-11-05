const ESCAPED: Record<string, string> = { "\\": "\\\\", "\t": "\\t", "\n": "\\n", "\r": "\\r", "'": "\\'" };

export const escapeParam = (value: string | number) => (typeof value === "number" ? String(value) : value.replace(/[\\\t\n\r']/g, (c) => ESCAPED[c]!));

export const paramSearch = (params: Record<string, string | number>) => Object.entries(params).map(([name, value]) => [`param_${name}`, escapeParam(value)] as const);
