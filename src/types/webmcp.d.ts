export {};

type WebMcpToolInfo = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  origin?: string;
  window?: Window;
};

type WebMcpContext = EventTarget & {
  registerTool(
    tool: {
      name: string;
      description: string;
      inputSchema?: unknown;
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
