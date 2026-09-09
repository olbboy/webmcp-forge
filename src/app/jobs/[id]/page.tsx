import { JobCatalog } from "@/components/job-catalog";
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
      <JobCatalog job={job} />
    </main>
  );
}
