import { jobErrorResponse } from "@/lib/job-error-response";
import { publishSummary, republishJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retries publishing the bundle already on disk. Separate from generate so a
 * transient CDN outage can be recovered from without rebuilding the bundle,
 * which would change its version and invalidate every cached copy.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const job = await republishJob(id);
    return Response.json(publishSummary(job));
  } catch (err) {
    return jobErrorResponse(err);
  }
}
