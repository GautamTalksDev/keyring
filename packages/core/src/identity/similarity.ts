import { normalizeEmailValue } from "../person.js";

/**
 * Username ↔ display-name similarity (signal 4).
 * Returns a score in [0, 1]. Only scores ≥ 0.72 are treated as a probable match;
 * this signal is never elevated to `certain`.
 */
export function usernameNameSimilarity(username: string, displayName: string): number {
  const user = normalizeHandle(username);
  if (user.length < 2) return 0;

  const parts = displayName
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return 0;

  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  const compact = parts.join("");
  const initials = parts.map((p) => p[0]).join("");
  const firstInitialLast = `${first[0] ?? ""}${last}`;
  const firstLastInitial = `${first}${last[0] ?? ""}`;
  const lastFirst = `${last}${first}`;

  const candidates = new Set(
    [first, last, compact, initials, firstInitialLast, firstLastInitial, lastFirst]
      .map(normalizeHandle)
      .filter((c) => c.length >= 2),
  );

  let best = 0;
  for (const candidate of candidates) {
    if (user === candidate) best = Math.max(best, 1);
    else if (user.startsWith(candidate) || candidate.startsWith(user)) {
      const ratio = Math.min(user.length, candidate.length) / Math.max(user.length, candidate.length);
      best = Math.max(best, 0.75 + 0.2 * ratio);
    } else if (user.includes(candidate) && candidate.length >= 3) {
      best = Math.max(best, 0.7 + 0.1 * (candidate.length / user.length));
    } else if (candidate.includes(user) && user.length >= 3) {
      best = Math.max(best, 0.68);
    }
  }

  // "schen-dev" → Sarah Chen: schen matches firstInitialLast
  if (last.length >= 3 && user.includes(last) && user.includes(first[0] ?? "")) {
    best = Math.max(best, 0.85);
  }

  return Math.min(1, best);
}

export const USERNAME_SIMILARITY_THRESHOLD = 0.72;

function normalizeHandle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function emailsEqual(a: string, b: string): boolean {
  return normalizeEmailValue(a) === normalizeEmailValue(b);
}
