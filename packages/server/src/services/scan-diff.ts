/**
 * Diff grant inventories between two scans.
 * New access appearing is as interesting as old access lingering.
 */

export interface ScanGrantSnapshot {
  grantIds: string[];
  /** Optional richer rows for change classification. */
  grants?: Array<{
    id: string;
    system: string;
    capability: string;
    resourceId: string;
  }>;
}

export interface ScanDiff {
  baselineScanId: string | null;
  currentScanId: string;
  added: string[];
  removed: string[];
  unchanged: string[];
  /** Grants present in both but capability/resource changed (by id overlap with metadata). */
  changed: string[];
}

export function diffGrantSnapshots(
  current: ScanGrantSnapshot & { scanId: string },
  baseline: (ScanGrantSnapshot & { scanId: string }) | null,
): ScanDiff {
  const cur = new Set(current.grantIds);
  const base = new Set(baseline?.grantIds ?? []);

  const added = [...cur].filter((id) => !base.has(id)).sort();
  const removed = [...base].filter((id) => !cur.has(id)).sort();
  const unchanged = [...cur].filter((id) => base.has(id)).sort();

  const changed: string[] = [];
  if (baseline?.grants && current.grants) {
    const prev = new Map(baseline.grants.map((g) => [g.id, g]));
    for (const g of current.grants) {
      const p = prev.get(g.id);
      if (!p) continue;
      if (
        p.capability !== g.capability ||
        p.resourceId !== g.resourceId ||
        p.system !== g.system
      ) {
        changed.push(g.id);
      }
    }
  }

  return {
    baselineScanId: baseline?.scanId ?? null,
    currentScanId: current.scanId,
    added,
    removed,
    unchanged,
    changed: changed.sort(),
  };
}

/** Keep cards whose grants are new or changed (or all held/protected). */
export function filterCardsToDiff<T extends { grant: { id: string }; status: string; protected?: boolean }>(
  cards: T[],
  diff: ScanDiff,
): T[] {
  if (!diff.baselineScanId) return cards;
  const interesting = new Set([...diff.added, ...diff.changed]);
  return cards.filter(
    (c) =>
      interesting.has(c.grant.id) ||
      c.protected === true ||
      c.status === "held",
  );
}
