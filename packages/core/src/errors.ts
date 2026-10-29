export class ArdiaError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ArdiaError";
  }
}

export const ardiaError = (error: unknown): ArdiaError =>
  error instanceof ArdiaError
    ? error
    : new ArdiaError(String((error as { code?: unknown } | null)?.code ?? "ERR_UNKNOWN"), String((error as { message?: unknown } | null)?.message ?? error));
