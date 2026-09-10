import { SCAN_TIMEOUT_MS } from "@/lib/config";
import { runScan } from "@/lib/jobs";
import { SCAN_BLOCKED_MESSAGE, ScanBlockedError } from "@/lib/net-guard";
import {
  acquireScan,
  clientIp,
  concurrencyRetryAfterSeconds,
  rateKey,
  releaseScan,
  takeSlot,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Past this, the scan is not slow, it is stuck. The request gets an answer
 * either way; the slot it held is reclaimed separately.
 */
const HARD_TIMEOUT_MS = SCAN_TIMEOUT_MS * 2;

/**
 * The origin to exempt from the scan guard, or nothing.
 *
 * The "Try the demo shop" button asks for a URL on the address the app is
 * answering on. Deployed that is a public hostname the guard allows anyway, so
 * the exemption is only ever needed while developing, where the app answers on
 * loopback.
 *
 * It is read from the Host header, because Next rewrites `request.url` to
 * `localhost` regardless of what the browser asked for, and `localhost` and
 * `127.0.0.1` are different origins. A header the caller controls is exactly
 * what must not decide this in production — which is why the whole thing is
 * switched off there rather than validated.
 */
function developmentSelfOrigin(request: Request): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  const host = request.headers.get("host");
  if (!host) return undefined;
  try {
    return new URL(`http://${host}`).origin;
  } catch {
    return undefined;
  }
}

function tooMany(message: string, retryAfterSeconds: number): Response {
  return Response.json(
    { error: message },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } }
  );
}

export async function POST(request: Request) {
  let body: { url?: string } = {};
  try {
    body = (await request.json()) as { url?: string };
  } catch {
    return Response.json({ error: "JSON body required" }, { status: 400 });
  }
  if (!body.url || typeof body.url !== "string") {
    return Response.json({ error: "url is required" }, { status: 400 });
  }

  // The concurrency ceiling is checked first on purpose. Turned away by it, a
  // caller has not had a scan; charging them one against their daily quota for
  // a request the server declined to run is the wrong way round.
  const slotToken = acquireScan();
  if (slotToken === null) {
    return tooMany(
      "Too many scans running right now. Try again shortly.",
      concurrencyRetryAfterSeconds()
    );
  }

  try {
    const slot = takeSlot(rateKey(clientIp(request)));
    if (!slot.ok) {
      return tooMany(
        "Too many scans from this address. Try again shortly.",
        slot.retryAfterSeconds
      );
    }

    const selfOrigin = developmentSelfOrigin(request);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const job = await Promise.race([
        runScan(body.url, selfOrigin),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Scan timed out")),
            HARD_TIMEOUT_MS
          );
        }),
      ]);
      const status = job.status === "error" ? 422 : 200;
      return Response.json(job, { status });
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (err) {
    // A refused address answers 400 with nothing attached: no job was created,
    // and the message is the same one every other refusal uses so the reply
    // cannot be read as a report on what is running inside the network.
    if (err instanceof ScanBlockedError) {
      return Response.json({ error: SCAN_BLOCKED_MESSAGE }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Scan failed";
    return Response.json({ error: message }, { status: 400 });
  } finally {
    // Paired with the acquire above, and outside every early return. A slot
    // that leaks here is a slot nobody gets back.
    releaseScan(slotToken);
  }
}
