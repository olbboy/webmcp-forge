import { JobError } from "./jobs";

/**
 * Turns a thrown job error into a response.
 *
 * Only a `JobError` carries a message meant for a client. Anything else is a
 * server fault whose text can contain a filesystem path or another internal
 * detail, so it is logged and answered with a generic 500.
 */
export function jobErrorResponse(err: unknown): Response {
  if (err instanceof JobError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  console.error("job route failed:", err);
  return Response.json({ error: "Internal error" }, { status: 500 });
}
