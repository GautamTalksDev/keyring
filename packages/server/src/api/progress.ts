import { createHash, createHmac, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import type { FastifyBaseLogger } from "fastify";

/** Child logger that always includes scanId when present. */
export function scanLog(
  log: FastifyBaseLogger,
  scanId: string,
): FastifyBaseLogger {
  return log.child({ scanId });
}

export type ScanProgressEvent =
  | {
      type: "scan.started";
      scanId: string;
      person?: string;
      scope?: string;
      driver: string;
      at: string;
    }
  | {
      type: "subagent.started";
      scanId: string;
      systemId: string;
      displayName: string;
      at: string;
    }
  | {
      type: "subagent.progress";
      scanId: string;
      systemId: string;
      found: number;
      at: string;
    }
  | {
      type: "subagent.done";
      scanId: string;
      systemId: string;
      found: number;
      at: string;
    }
  | {
      type: "subagent.failed";
      scanId: string;
      systemId: string;
      displayName?: string;
      at: string;
      error: string;
      errorKind?: string;
      recovery?: string;
    }
  | {
      type: "reconcile.started" | "reconcile.done";
      scanId: string;
      at: string;
      clusters?: number;
      unknown?: number;
    }
  | {
      type: "scan.diff";
      scanId: string;
      at: string;
      baselineScanId: string | null;
      added: number;
      removed: number;
      changed: number;
      unchanged: number;
      diffOnly: boolean;
    }
  | {
      type: "cards.persisted";
      scanId: string;
      cardCount: number;
      at: string;
    }
  | {
      type: "scan.completed" | "scan.failed" | "scan.cost_capped" | "scan.partial";
      scanId: string;
      at: string;
      error?: string;
      errorKind?: string;
      recovery?: string;
      grantsDiscovered?: number;
      failedSystems?: string[];
      costs?: {
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
        hardCapUsd: number;
        capped: boolean;
      };
    }
  | {
      type: "cost.update";
      scanId: string;
      at: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      hardCapUsd: number;
      capped: boolean;
    }
  | {
      type: "trueforge.event";
      scanId: string;
      at: string;
      eventType: string;
      threadId?: string | null;
      detail?: string;
    }
  | {
      type: "execute.card";
      scanId: string;
      cardId: string;
      phase: "before" | "after";
      result: string;
      error?: string;
      detail?: string;
      dryRun?: boolean;
      restorable?: boolean;
      at: string;
    }
  | {
      type: "execute.done";
      scanId: string;
      at: string;
      dryRun?: boolean;
      executed: number;
      failed: number;
      skipped: number;
    };

/** In-process progress bus for SSE (single server replica). */
class ScanBus {
  private readonly emitters = new Map<string, EventEmitter>();
  private readonly buffers = new Map<string, ScanProgressEvent[]>();

  ensure(scanId: string): EventEmitter {
    let ee = this.emitters.get(scanId);
    if (!ee) {
      ee = new EventEmitter();
      ee.setMaxListeners(50);
      this.emitters.set(scanId, ee);
      this.buffers.set(scanId, []);
    }
    return ee;
  }

  publish(event: ScanProgressEvent): void {
    const ee = this.ensure(event.scanId);
    const buf = this.buffers.get(event.scanId) ?? [];
    buf.push(event);
    // Keep last 500 events for late subscribers
    if (buf.length > 500) buf.splice(0, buf.length - 500);
    this.buffers.set(event.scanId, buf);
    ee.emit("event", event);
  }

  history(scanId: string): ScanProgressEvent[] {
    return [...(this.buffers.get(scanId) ?? [])];
  }

  subscribe(
    scanId: string,
    handler: (event: ScanProgressEvent) => void,
  ): () => void {
    const ee = this.ensure(scanId);
    ee.on("event", handler);
    return () => {
      ee.off("event", handler);
    };
  }
}

export const scanBus = new ScanBus();

export function newScanId(): string {
  return randomUUID();
}

export function signExport(
  body: string,
  secret: string,
): { signature: string; algorithm: "hmac-sha256" } {
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return { signature, algorithm: "hmac-sha256" };
}

export function contentHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}
