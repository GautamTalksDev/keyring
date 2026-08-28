import type { ProductErrorKind } from "../lib/errors.js";

export function ErrorBanner({
  kind,
  message,
  recovery,
  onDismiss,
  onRetry,
}: {
  kind: ProductErrorKind | null;
  message: string;
  recovery?: string | null;
  onDismiss?: () => void;
  onRetry?: () => void;
}) {
  const title = titleFor(kind);
  return (
    <div
      className="shrink-0 border-b border-[var(--color-irrev)] bg-[var(--color-irrev-soft)] px-5 py-3 text-[12px] text-[var(--color-irrev)]"
      role="alert"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold tracking-tight">{title}</div>
          <p className="mt-0.5 text-[var(--color-ink-2)]">{message}</p>
          {recovery ? (
            <p className="mt-1.5 text-[var(--color-mute)]">
              <span className="font-medium text-[var(--color-ink)]">Recovery: </span>
              {recovery}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="border border-[var(--color-ink)] bg-[var(--color-ink)] px-2.5 py-1 text-[11px] font-medium text-white"
            >
              Retry
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="border border-[var(--color-line-strong)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-ink)]"
            >
              Dismiss
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function titleFor(kind: ProductErrorKind | null): string {
  switch (kind) {
    case "connector_auth":
      return "Connector auth failure";
    case "rate_limit":
      return "Rate limit reached";
    case "partial":
      return "Partial scan";
    case "cost_capped":
      return "Spend cap reached";
    case "execution":
      return "Execution failure";
    default:
      return "Scan error";
  }
}
