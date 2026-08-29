import type { ApiCard, ExecuteResult, ScanCostSnapshot, ScanProgressEvent } from "./types.js";

const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function startScan(input: {
  person?: string;
  scope?: string;
  driver?: "fixture" | "trueforge" | "record" | "replay";
  recordingId?: string;
}): Promise<{
  scanId: string;
  driver: string;
  status: string;
  recordingId?: string;
}> {
  const driver =
    (import.meta.env.VITE_SCAN_DRIVER as
      "fixture" | "trueforge" | "record" | "replay" | undefined) ??
    input.driver ??
    "fixture";
  return request("/scans", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      driver,
    }),
  });
}

export async function fetchCards(scanId: string): Promise<{
  scanId: string;
  status: string;
  cards: ApiCard[];
  costs?: ScanCostSnapshot | null;
  driver?: string | null;
  recordingId?: string | null;
}> {
  return request(`/scans/${scanId}/cards`);
}

export async function postDecision(
  cardId: string,
  body: {
    decision: "approve" | "hold" | "reject";
    note?: string;
    by?: string;
    bulk?: boolean;
  },
): Promise<{ card: ApiCard; message: string }> {
  return request(`/cards/${cardId}/decision`, {
    method: "POST",
    body: JSON.stringify({ by: "operator", ...body }),
  });
}

export async function executeScan(
  scanId: string,
  approvedBy = "operator",
  dryRun = true,
): Promise<{
  scanId: string;
  dryRun: boolean;
  executed: number;
  failed: number;
  skipped: number;
  results: ExecuteResult[];
}> {
  return request(`/scans/${scanId}/execute`, {
    method: "POST",
    body: JSON.stringify({ approvedBy, dryRun }),
  });
}

/**
 * Subscribe to scan SSE. Returns an unsubscribe function.
 * Replays snapshot history, then live events.
 */
export function subscribeScanStream(
  scanId: string,
  handlers: {
    onEvent: (event: ScanProgressEvent) => void;
    onError?: (err: Error) => void;
  },
): () => void {
  const url = `${base}/scans/${scanId}/stream`;
  const es = new EventSource(url);

  const forward = (type: string, data: string) => {
    try {
      const parsed = JSON.parse(data) as ScanProgressEvent;
      if (type === "snapshot") {
        const history = (parsed as { history?: ScanProgressEvent[] }).history ?? [];
        for (const h of history) handlers.onEvent(h);
        return;
      }
      handlers.onEvent({ ...parsed, type: parsed.type || type });
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  es.addEventListener("snapshot", (e) => forward("snapshot", (e as MessageEvent).data));
  const types = [
    "scan.started",
    "subagent.queued",
    "subagent.started",
    "subagent.progress",
    "subagent.done",
    "reconcile.started",
    "reconcile.done",
    "cards.persisted",
    "scan.completed",
    "scan.failed",
    "scan.cost_capped",
    "scan.partial",
    "cost.update",
    "trueforge.event",
    "execute.card",
    "execute.done",
    "subagent.failed",
  ];
  for (const t of types) {
    es.addEventListener(t, (e) => forward(t, (e as MessageEvent).data));
  }
  es.onmessage = (e) => forward("message", e.data);
  es.onerror = () => {
    // EventSource retries; surface once for UI status
    handlers.onError?.(new Error("SSE connection interrupted"));
  };

  return () => es.close();
}
