export type JobStatus = "pending" | "scanning" | "ready" | "error" | "generated";

export type FormField = {
  name: string;
  type: string;
  placeholder?: string;
  label?: string;
  required?: boolean;
  selector: string;
};

export type ScannedForm = {
  id: string;
  action?: string;
  method?: string;
  selector: string;
  name?: string;
  ariaLabel?: string;
  fields: FormField[];
  isSearch?: boolean;
  isContact?: boolean;
  isCalculator?: boolean;
};

export type ScannedLink = {
  href: string;
  text: string;
  path: string;
  sameOrigin: boolean;
};

export type ProductCard = {
  title: string;
  price?: string;
  href?: string;
  selector: string;
};

export type SearchInput = {
  selector: string;
  placeholder?: string;
  name?: string;
  ariaLabel?: string;
};

export type ButtonHit = {
  text: string;
  selector: string;
  ariaLabel?: string;
  type?: string;
};

export type FilterControl = {
  selector: string;
  label: string;
  kind: "select" | "checkbox" | "radio";
};

export type PageSnapshot = {
  url: string;
  title: string;
  description?: string;
  headings: string[];
  navLinks: ScannedLink[];
  links: ScannedLink[];
  forms: ScannedForm[];
  buttons: ButtonHit[];
  searchInputs: SearchInput[];
  products: ProductCard[];
  filters: FilterControl[];
  error?: string;
};

export type ToolKind =
  | "get_page_info"
  | "get_site_nav"
  | "list_links"
  | "list_products"
  | "fill_form"
  | "search_on_page"
  | "click_by_text"
  | "open_path";

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
};

export type ToolCandidate = {
  id: string;
  name: string;
  description: string;
  kind: ToolKind;
  enabled: boolean;
  inputSchema: JsonSchema;
  selectors?: Record<string, string | string[]>;
  metadata?: Record<string, unknown>;
  source?: string;
};

/**
 * What a health check found about one tool.
 *
 * `missing` means its selector matches nothing on any page the scan recorded,
 * so a call would fail. `degraded` is only for the tools built from a list —
 * some of the labels or paths are gone, the rest still work.
 */
export type ToolHealth = {
  id: string;
  name: string;
  kind: ToolKind;
  status: "ok" | "degraded" | "missing";
  detail?: string;
};

export type HealthReport = {
  checkedAt: string;
  pagesChecked: number;
  /** Pages that would not open. Above zero, the picture is incomplete. */
  pagesFailed: number;
  tools: ToolHealth[];
};

export type SelectedTool = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
};

export type ScanJob = {
  id: string;
  url: string;
  origin: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  pages: PageSnapshot[];
  candidates: ToolCandidate[];
  selected?: SelectedTool[];
  includeLocalRelay: boolean;
  robotsDisallowAll?: boolean;
  error?: string;
  generatedAt?: string;

  /** Bundle version, incremented on every generate. Starts at 1. */
  version?: number;
  /**
   * Public CDN identity, minted on the first generate once the CDN is
   * configured and stable for the life of the job. Deliberately not the job
   * id: the job id is the owner's admin key, and this one is visible in the
   * page source of every site that embeds the bundle.
   */
  publicId?: string;
  publishStatus?: "skipped" | "published" | "failed" | "unpublished";
  /** Version currently on the CDN, which lags `version` after a failure. */
  publishedVersion?: number;
  publishedAt?: string;
  publishError?: string;
  hostedEmbedUrl?: string;
  hostedManifestUrl?: string;

  /** The most recent health check, if one has been run. */
  health?: HealthReport;
};

export type EmbedManifest = {
  name: string;
  version: string;
  generatedAt: string;
  siteUrl: string;
  origin: string;
  includeLocalRelay: boolean;
  localRelaySrc: string;
  polyfill: {
    prefer: "document.modelContext";
    fallback: "navigator.modelContext";
    note: string;
  };
  tools: ToolCandidate[];
};
