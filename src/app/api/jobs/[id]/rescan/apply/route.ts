import { jobErrorResponse } from "@/lib/job-error-response";
import { applyRescan } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Accepts the parked re-scan.
 *
 * The tools become what the scan found, keeping every name the owner chose and
 * every switch they set. Nothing reaches their site yet: the bundle is rebuilt
 * and published by Generate, which is still a separate, deliberate step.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const job = await applyRescan(id);
    return Response.json({
      id: job.id,
      status: job.status,
      version: job.version,
      candidates: job.candidates,
      // The page summary below the tool list is built from these. Without
      // them it would keep describing the markup the re-scan just replaced.
      pages: job.pages,
    });
  } catch (err) {
    return jobErrorResponse(err);
  }
}
