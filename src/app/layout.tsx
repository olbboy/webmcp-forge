import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WebMCP Forge — SEO for agents",
  description:
    "Scan any public website, pick WebMCP tools, and embed a script that registers structured tools in the visitor's open tab. No React SDK required.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="border-b">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-xs text-primary-foreground">
                WF
              </span>
              WebMCP Forge
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/fixture-shop/index.html" className="hover:text-foreground">
                Demo shop
              </Link>
              <a
                href="https://docs.mcp-b.ai/packages/webmcp-polyfill/reference"
                className="hover:text-foreground"
                target="_blank"
                rel="noreferrer"
              >
                WebMCP
              </a>
            </nav>
          </div>
        </header>
        <div className="flex-1">{children}</div>
        <footer className="border-t">
          <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-muted-foreground">
            Tools run in the user&apos;s open tab session (cookies, auth, live DOM) — not a
            separate backend MCP server. Compatible with native Chrome{" "}
            <code>document.modelContext</code>,{" "}
            <code>@mcp-b/webmcp-polyfill</code>, and optional{" "}
            <code>@mcp-b/webmcp-local-relay</code> for Cursor.
          </div>
        </footer>
      </body>
    </html>
  );
}
