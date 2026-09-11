import { jobErrorResponse } from "@/lib/job-error-response";
import { runHealthCheck } from "@/lib/jobs";
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
 * Checks whether this job's tools can still find what they act on.
 *
 * It opens a browser over the same pages a scan would, so it takes a
 * concurrency slot like a scan does. Without that it would be a way around the
 * ceiling that keeps this box usable for the service sharing it.
 *
 * There is no per-address allowance here: reaching this route already means
 * holding the job id, which is the owner's key, and an owner checking their own
 * site repeatedly is not the traffic that limit is for.
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
    const job = await runHealthCheck(id, developmentSelfOrigin(request));
    return Response.json({ id: job.id, health: job.health });
  } catch (err) {
    return jobErrorResponse(err);
  } finally {
    releaseScan(slotToken);
  }
}
