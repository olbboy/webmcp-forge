import { JobCatalog } from "@/components/job-catalog";
import { isCdnConfigured } from "@/lib/cdn";
import { getJob } from "@/lib/store";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-10">
      {/* Whether hosting is available is server state; the browser has no
          way to read it, so it is passed down. */}
      <JobCatalog job={job} cdnConfigured={isCdnConfigured()} />
    </main>
  );
}
