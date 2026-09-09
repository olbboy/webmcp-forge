import { getEmbedJs } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const js = await getEmbedJs(id);
  if (!js) return Response.json({ error: "Job not found" }, { status: 404 });
  return new Response(js, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": 'attachment; filename="webmcp-forge.embed.js"',
    },
  });
}
