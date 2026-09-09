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
