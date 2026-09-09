import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Job not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Anonymous scan jobs live on this server&apos;s disk. If this id is old or
        from another machine, start a new scan.
      </p>
      <p className="mt-6">
        <Link href="/" className="underline">
          Back to WebMCP Forge
        </Link>
      </p>
    </main>
  );
}
