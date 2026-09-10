import { jobErrorResponse } from "@/lib/job-error-response";
import { publishSummary, unpublishJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Takes the bundle off the CDN. Visitors keep the cached copy for up to five
 * minutes, so this is a kill switch with a delay, not an instant one.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const job = await unpublishJob(id);
    return Response.json(publishSummary(job));
  } catch (err) {
    return jobErrorResponse(err);
  }
}
