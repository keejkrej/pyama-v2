function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return error;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string" &&
    (error as { message: string }).message.length > 0
  ) {
    return new Error((error as { message: string }).message);
  }
  return new Error(typeof error === "string" && error.length > 0 ? error : fallback);
}

export function toErrorMessage(error: unknown, fallback = "Unknown error"): string {
  return toError(error, fallback).message;
}
