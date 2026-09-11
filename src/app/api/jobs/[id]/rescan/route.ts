import { jobErrorResponse } from "@/lib/job-error-response";
import { discardRescan, rescanJob } from "@/lib/jobs";
import { developmentSelfOrigin } from "@/lib/net-guard";
import {
  acquireScan,
  concurrencyRetryAfterSeconds,
  releaseScan,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scans the site again and parks the result for review.
 *
 * Takes a concurrency slot, because it is a scan in every way that costs
 * anything. No per-address allowance: reaching this route means holding the job
 * id, which is the owner's key, and an owner re-scanning their own site is not
 * the traffic that limit exists for.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const slotToken = acquireScan();
  if (slotToken === null) {
    return Response.json(
      { error: "Too many scans running right now. Try again shortly." },
      {
        status: 429,
        headers: { "retry-after": String(concurrencyRetryAfterSeconds()) },
      }
    );
  }

  try {
    const job = await rescanJob(id, developmentSelfOrigin(request));
    return Response.json({ id: job.id, pendingRescan: job.pendingRescan });
  } catch (err) {
    return jobErrorResponse(err);
  } finally {
    releaseScan(slotToken);
  }
}

/** Throws the parked re-scan away. The job is left exactly as it was. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const job = await discardRescan(id);
    return Response.json({ id: job.id, pendingRescan: null });
  } catch (err) {
    return jobErrorResponse(err);
  }
}
