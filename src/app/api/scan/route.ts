import { runScan } from "@/lib/jobs";
import { SCAN_BLOCKED_MESSAGE, ScanBlockedError } from "@/lib/net-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  // Where this app is answering. The demo button asks for a URL on this very
  // origin, which in development is localhost — an address the scan guard
  // refuses for everyone else.
  let selfOrigin: string | undefined;
  try {
    selfOrigin = new URL(request.url).origin;
  } catch {
    selfOrigin = undefined;
  }

  try {
    const job = await runScan(body.url, selfOrigin);
    const status = job.status === "error" ? 422 : 200;
    return Response.json(job, { status });
  } catch (err) {
    // A refused address answers 400 with nothing attached: no job was created,
    // and the message is the same one every other refusal uses so the reply
    // cannot be read as a report on what is running inside the network.
    if (err instanceof ScanBlockedError) {
      return Response.json({ error: SCAN_BLOCKED_MESSAGE }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Scan failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
