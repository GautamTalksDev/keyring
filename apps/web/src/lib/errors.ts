export type ProductErrorKind =
  | "connector_auth"
  | "rate_limit"
  | "partial"
  | "cost_capped"
  | "execution"
  | "unknown";

const RECOVERY: Record<ProductErrorKind, string> = {
  connector_auth:
    "Re-authorize the failing connector in TrueForge (MCP auth), then retry the scan.",
  rate_limit:
    "Wait for the provider rate window to reset, then retry. Offline demos: use replay mode.",
  partial:
    "Review grants from systems that succeeded. Fix the failing connector, then re-run the scan.",
  cost_capped:
    "Raise KEYRING_HARD_CAP_USD only if intentional, or use pnpm demo (replay, no API keys).",
  execution:
    "Confirm dry-run vs live intent, check connector write credentials, then retry failed cards.",
  unknown: "Check server logs for the scanId, then retry. Prefer pnpm demo for offline review.",
};

export function recoveryFor(
  kind: ProductErrorKind | string | null | undefined,
  fallback?: string | null,
): string {
  if (fallback) return fallback;
  if (kind && kind in RECOVERY) return RECOVERY[kind as ProductErrorKind];
  return RECOVERY.unknown;
}

export function classifyClientError(message: string): ProductErrorKind {
  const lower = message.toLowerCase();
  if (/unauthorized|forbidden|auth|credentials|401|403/.test(lower)) {
    return "connector_auth";
  }
  if (/rate.?limit|too many|429/.test(lower)) return "rate_limit";
  if (/spend cap|cost cap|hard_cap/.test(lower)) return "cost_capped";
  if (/partial/.test(lower)) return "partial";
  if (/execute|revoke|mutat/.test(lower)) return "execution";
  return "unknown";
}
