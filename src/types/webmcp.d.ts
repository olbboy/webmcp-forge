export {};

/**
 * The three hints the WebMCP draft defines. They are not MCP's set — only
 * `readOnlyHint` appears in both — and they are advice to the client, not a
 * guarantee the tool honours. The gate that actually stops a click is in the
 * embed's own code.
 */
type WebMcpToolAnnotations = {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
};

type WebMcpToolInfo = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: WebMcpToolAnnotations;
  origin?: string;
  window?: Window;
};

type WebMcpContext = EventTarget & {
  registerTool(
    tool: {
      name: string;
      description: string;
      inputSchema?: unknown;
      annotations?: WebMcpToolAnnotations;
      execute: (args: Record<string, unknown>) => unknown;
    },
    options?: { signal?: AbortSignal }
  ): Promise<void>;
  getTools(options?: { fromOrigins?: string[] }): Promise<WebMcpToolInfo[]>;
  executeTool?(
    tool: WebMcpToolInfo | string,
    inputJson?: string
  ): Promise<unknown>;
};

declare global {
  interface Document {
    modelContext?: WebMcpContext;
  }
  interface Navigator {
    modelContext?: WebMcpContext;
  }
  interface Window {
    __WEBMCP_FORGE_READY__?: Promise<unknown>;
    __WEBMCP_FORGE_MANIFEST__?: unknown;
  }
}
