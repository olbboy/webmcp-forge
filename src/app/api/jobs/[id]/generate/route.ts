import { generateJobBundle } from "@/lib/jobs";
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
    const { job } = await generateJobBundle(
      id,
      body.tools,
      Boolean(body.includeLocalRelay)
    );
    return Response.json({
      id: job.id,
      status: job.status,
      includeLocalRelay: job.includeLocalRelay,
      embedJs: `/api/jobs/${id}/embed.js`,
      manifest: `/api/jobs/${id}/manifest.json`,
      toolCount: job.selected?.filter((t) => t.enabled !== false).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generate failed";
    const status = message === "Job not found" ? 404 : 400;
    return Response.json({ error: message }, { status });
  }
}
