import { jobErrorResponse } from "@/lib/job-error-response";
import { generateAndPublish, publishSummary } from "@/lib/jobs";
import type { SelectedTool } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: {
    tools?: SelectedTool[];
    includeLocalRelay?: boolean;
  } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    // Publishing is attempted here but never gates the response: a CDN outage
    // leaves the owner with a working self-host download and a retry button.
    const job = await generateAndPublish(
      id,
      body.tools,
      Boolean(body.includeLocalRelay)
    );
    return Response.json({
      ...publishSummary(job),
      includeLocalRelay: job.includeLocalRelay,
      embedJs: `/api/jobs/${id}/embed.js`,
      manifest: `/api/jobs/${id}/manifest.json`,
      toolCount: job.selected?.filter((t) => t.enabled !== false).length,
    });
  } catch (err) {
    return jobErrorResponse(err);
  }
}
