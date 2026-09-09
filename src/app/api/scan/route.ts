import { runScan } from "@/lib/jobs";

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
  try {
    const job = await runScan(body.url);
    const status = job.status === "error" ? 422 : 200;
    return Response.json(job, { status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
