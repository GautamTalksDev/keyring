/**
 * Classify scan / connector / execution failures for UI recovery paths.
 */
export type ProductErrorKind =
  | "connector_auth"
  | "rate_limit"
  | "partial"
  | "cost_capped"
  | "execution"
  | "unknown";

export type ClassifiedError = {
  kind: ProductErrorKind;
  message: string;
  recovery: string;
};

const RECOVERY: Record<ProductErrorKind, string> = {
  connector_auth:
    "Re-authorize the failing connector in TrueForge (MCP auth), then retry the scan.",
  rate_limit:
    "Wait for the provider rate window to reset, lower KEYRING_MCP_MAX_PER_SECOND, then retry.",
  partial:
    "Review grants from systems that succeeded. Fix the failing connector, then re-run the scan.",
  cost_capped:
    "Raise KEYRING_HARD_CAP_USD only if intentional, or use driver=replay / fixtures for offline demos.",
  execution:
    "Confirm dry-run vs live intent, check connector write credentials, then retry the failed cards.",
  unknown: "Check server logs for the scanId, then retry. Prefer replay mode for demos.",
};

export function classifyProductError(
  err: unknown,
  fallback: ProductErrorKind = "unknown",
): ClassifiedError {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  const status =
    err && typeof err === "object" && "status" in err
      ? Number((err as { status?: number }).status)
      : undefined;

  let kind: ProductErrorKind = fallback;

  if (
    status === 401 ||
    status === 403 ||
    /unauthorized|forbidden|auth(_| )?required|invalid.?token|credentials|not authenticated|access denied/.test(
      lower,
    )
  ) {
    kind = "connector_auth";
  } else if (
    status === 429 ||
    /rate.?limit|too many requests|quota exceeded/.test(lower)
  ) {
    kind = "rate_limit";
  } else if (/spend cap|cost cap|hard_cap|hard cap/.test(lower)) {
    kind = "cost_capped";
  } else if (/partial/.test(lower)) {
    kind = "partial";
  } else if (/revoke|execute|mutat/.test(lower) && fallback === "execution") {
    kind = "execution";
  }

  return { kind, message, recovery: RECOVERY[kind] };
}

export function recoveryFor(kind: ProductErrorKind): string {
  return RECOVERY[kind];
}
