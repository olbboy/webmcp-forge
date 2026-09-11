import type {
  RescanProposal,
  ScanJob,
  SelectedTool,
  ToolCandidate,
  ToolChange,
} from "./types";

/**
 * Re-scanning a site the owner already has tools for.
 *
 * The reason this is not just "scan again" is the hosted URL. A fresh scan
 * mints a fresh job, and the job's public id is baked into the script tag on
 * the customer's site — so re-scanning used to mean pasting a new tag, and
 * losing every renamed and unticked tool along the way.
 *
 * It is also not allowed to simply replace what is there. The tools on a live
 * site were chosen, sometimes renamed, and sometimes deliberately switched off
 * by their owner; swapping them because the markup moved would undo that
 * without asking. So a re-scan produces a proposal and a list of differences,
 * and nothing takes effect until someone says so.
 */

/**
 * What a tool depends on, reduced to something comparable.
 *
 * Names and descriptions are left out on purpose: the owner is allowed to
 * rename a tool, and a scan that re-derives the original name should not
 * report that as a change to their site.
 */
function signatureOf(tool: ToolCandidate): string {
  const selectors = tool.selectors
    ? Object.fromEntries(
        Object.entries(tool.selectors).map(([key, value]) => [
          key,
          (Array.isArray(value) ? value : [value]).slice().sort(),
        ])
      )
    : {};
  const allowlist = Array.isArray(tool.metadata?.allowlist)
    ? (tool.metadata.allowlist as string[]).slice().sort()
    : undefined;
  return JSON.stringify({ selectors, allowlist });
}

function allowlistSize(tool: ToolCandidate): number | undefined {
  return Array.isArray(tool.metadata?.allowlist)
    ? (tool.metadata.allowlist as string[]).length
    : undefined;
}

function describeUpdate(before: ToolCandidate, after: ToolCandidate): string {
  const wasList = allowlistSize(before);
  const nowList = allowlistSize(after);
  if (wasList !== undefined && nowList !== undefined && wasList !== nowList) {
    return `${wasList} → ${nowList} entries it can act on`;
  }
  return "it points at different markup than before";
}

/** What changed between the tools a job holds and the ones a re-scan found. */
export function diffTools(
  before: ToolCandidate[],
  after: ToolCandidate[]
): ToolChange[] {
  const byIdBefore = new Map(before.map((tool) => [tool.id, tool]));
  const byIdAfter = new Map(after.map((tool) => [tool.id, tool]));
  const changes: ToolChange[] = [];

  for (const tool of after) {
    const previous = byIdBefore.get(tool.id);
    if (!previous) {
      changes.push({
        id: tool.id,
        name: tool.name,
        kind: tool.kind,
        change: "added",
        detail: "the site has something here it did not before",
      });
      continue;
    }
    changes.push(
      signatureOf(previous) === signatureOf(tool)
        ? { id: tool.id, name: previous.name, kind: tool.kind, change: "unchanged" }
        : {
            id: tool.id,
            name: previous.name,
            kind: tool.kind,
            change: "updated",
            detail: describeUpdate(previous, tool),
          }
    );
  }

  for (const tool of before) {
    if (byIdAfter.has(tool.id)) continue;
    changes.push({
      id: tool.id,
      name: tool.name,
      kind: tool.kind,
      change: "removed",
      detail: "the scan no longer finds what this acts on",
    });
  }

  const order = { removed: 0, updated: 1, added: 2, unchanged: 3 } as const;
  return changes.sort((a, b) => order[a.change] - order[b.change]);
}

/** True when the proposal would change anything at all. */
export function hasChanges(proposal: RescanProposal): boolean {
  return proposal.changes.some((change) => change.change !== "unchanged");
}

/**
 * What the owner had decided about each tool before the re-scan.
 *
 * `selected` is only written by a generate, so a job that was scanned and never
 * generated has none — and for that job every candidate was implicitly on, with
 * the name the scan gave it.
 */
function priorChoices(job: ScanJob): Map<string, SelectedTool> {
  const source: SelectedTool[] = job.selected?.length
    ? job.selected
    : job.candidates.map((tool) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        enabled: true,
      }));
  return new Map(source.map((tool) => [tool.id, tool]));
}

/**
 * Folds a proposal into the job, keeping the decisions the owner had made.
 *
 * A tool that survives keeps the name, description and on/off state it had. A
 * tool the re-scan found for the first time arrives switched **off**: it has
 * never been looked at, and a tool nobody chose should not start answering
 * agents on a customer's site because the markup changed.
 */
export function mergeProposal(job: ScanJob, proposal: RescanProposal): ScanJob {
  const prior = priorChoices(job);

  const candidates = proposal.candidates.map((tool) => {
    const chosen = prior.get(tool.id);
    if (!chosen) return { ...tool, enabled: false };
    return {
      ...tool,
      name: chosen.name || tool.name,
      description: chosen.description || tool.description,
      enabled: chosen.enabled,
    };
  });

  const selected: SelectedTool[] = candidates.map((tool) => ({
    id: tool.id,
    name: tool.name,
    description: tool.description,
    enabled: tool.enabled,
  }));

  return {
    ...job,
    url: proposal.url,
    origin: proposal.origin,
    pages: proposal.pages,
    candidates,
    selected,
    robotsDisallowAll: proposal.robotsDisallowAll,
    // The bundle on disk was built from the tools that were here a moment ago,
    // so it is no longer what this job describes. Back to ready: the owner
    // generates again when they want the change to reach their site.
    status: "ready",
    // Bumped even though nothing has been published yet, because a rebuild of a
    // missing artifact reads the version off the job. Left alone, the same
    // number would come to mean two different bundles — and that number is what
    // the CDN hands out as its cache validator.
    version: (job.version ?? 0) + 1,
    // The last health check was about the tools that were here a moment ago,
    // some of which no longer exist. Keeping it would put verdicts on screen
    // next to tools they were never about.
    health: undefined,
    pendingRescan: undefined,
  };
}
