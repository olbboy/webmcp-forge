/**
 * Runs once when the server starts.
 *
 * The only thing here is the scan guard's escape hatch announcing itself. A
 * check at deploy time cannot stop someone adding that variable months later
 * to debug one site, so the warning has to be in the log a deploy is read
 * against — not waiting for the first scan to trigger it.
 *
 * The import is deferred and gated on the runtime because Next compiles this
 * file for the Edge runtime as well, and the guard reaches for `node:net` and
 * `node:dns`, which do not exist there.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { warnIfEscapeHatchOpen } = await import("@/lib/net-guard");
  warnIfEscapeHatchOpen();
}
