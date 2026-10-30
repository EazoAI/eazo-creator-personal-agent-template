import "server-only";

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Resume/start conflict when the session's previous run has not finished (HTTP 409 or conflict code). */
export function isBusySessionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: string };
  if (e.status === 409) return true;
  if (typeof e.code === "string" && e.code.toLowerCase().includes("conflict")) return true;
  return false;
}
