"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ScanForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function demoUrl() {
    return `${window.location.origin}/fixture-shop/index.html`;
  }

  function useDemo() {
    const demo = demoUrl();
    if (inputRef.current) inputRef.current.value = demo;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = inputRef.current?.value.trim() || "";
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as {
        id?: string;
        error?: string;
      };
      if (!res.ok || data.error) {
        throw new Error(data.error || `Scan failed (${res.status})`);
      }
      if (!data.id) throw new Error("Scan did not return a job id");
      router.push(`/jobs/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="site-url" className="text-sm font-medium">
          Site URL
        </label>
        <p className="text-xs text-muted-foreground">
          Dán URL trang công khai của bạn. Public pages only — we do not log in.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            ref={inputRef}
            id="site-url"
            name="url"
            type="url"
            required
            placeholder="https://example.com"
            className="h-10 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            disabled={loading}
          />
          <button
            type="submit"
            className={cn(buttonVariants({ variant: "default" }), "h-10 px-4")}
            disabled={loading}
          >
            {loading ? "Scanning…" : "Scan site"}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          className={cn(buttonVariants({ variant: "outline" }))}
          onClick={useDemo}
          disabled={loading}
        >
          Try the demo shop
        </button>
        <span className="text-muted-foreground">
          Opens home + up to 7 linked same-origin pages. Respects robots.txt
          lightly.
        </span>
      </div>
      {loading ? (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          Opening the site in a headless browser, collecting forms, nav, search,
          and product-like cards. This usually takes a few seconds.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
