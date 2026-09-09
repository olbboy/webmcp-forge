import { getManifestJson } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const json = await getManifestJson(id);
  if (!json) return Response.json({ error: "Job not found" }, { status: 404 });
  return new Response(json, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition":
        'attachment; filename="webmcp-forge.manifest.json"',
    },
  });
}
