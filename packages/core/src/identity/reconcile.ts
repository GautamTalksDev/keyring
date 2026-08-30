import { asPersonId, type GrantId } from "../brand.js";
import type { Confidence } from "../evidence.js";
import type { Grant } from "../grant.js";
import { sha256Hex } from "../hash.js";
import type { Identifier } from "../identifier.js";
import { normalizeEmailValue } from "../person.js";
import { USERNAME_SIMILARITY_THRESHOLD, usernameNameSimilarity } from "./similarity.js";
import type {
  DirectoryEntry,
  IdentityCluster,
  KeyAttribution,
  ReconciliationInput,
  ReconciliationResult,
  SignalKind,
  UnknownBucket,
} from "./types.js";
import { UnionFind } from "./union-find.js";

interface Edge {
  a: string;
  b: string;
  signal: SignalKind;
  confidence: Confidence;
  detail: string;
}

interface SeedCluster {
  key: string;
  displayName: string;
  kind: "human" | "service_account";
  identifiers: Identifier[];
  directory?: DirectoryEntry;
}

const MS_PER_DAY = 86_400_000;

function grantNode(id: GrantId | string): string {
  return `grant:${id}`;
}

function seedNode(key: string): string {
  return `seed:${key}`;
}

function collectIdentifiers(grant: Grant): Identifier[] {
  return grant.principal.identifiers.map((i) => ({
    kind: i.kind,
    value: i.kind.includes("email") ? normalizeEmailValue(i.value) : i.value.trim(),
    source: i.source,
  }));
}

function weaker(a: Confidence, b: Confidence): Confidence {
  const order: Confidence[] = ["certain", "probable", "speculative"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

function signalLabel(signal: SignalKind): string {
  switch (signal) {
    case "work_email_exact":
      return "exact work-email match";
    case "commit_email_matches_work":
      return "commit email matches work email";
    case "personal_email_in_directory":
      return "personal email present on the org directory record";
    case "username_in_directory":
      return "username listed on the org directory record";
    case "username_similarity":
      return "username similarity to directory display name (probable only)";
    case "key_attribution":
      return "key/token creation attributed to a resolved principal";
    case "temporal_onboarding":
      return "created in the same window as a resolved onboarding";
  }
}

/**
 * Cluster grants into people / service accounts using descending-trust signals.
 * Unattributable grants stay in `unknown` — never forced into a tidy cluster.
 */
export function reconcileIdentities(input: ReconciliationInput): ReconciliationResult {
  const grants = input.grants;
  const directory = input.directory ?? [];
  const keyAttributions = input.keyAttributions ?? [];
  const serviceAccounts = input.serviceAccounts ?? [];
  const windowDays = input.onboardingWindowDays ?? 14;

  const byId = new Map<string, Grant>();
  for (const g of grants) byId.set(g.id, g);

  const uf = new UnionFind();
  const edges: Edge[] = [];
  const seeds: SeedCluster[] = [];

  // --- Seed directory people ---
  for (const [index, entry] of directory.entries()) {
    const key = `person:${index}:${normalizeEmailValue(entry.workEmails[0] ?? entry.displayName)}`;
    const identifiers: Identifier[] = [];
    for (const email of entry.workEmails) {
      identifiers.push({
        kind: "work_email",
        value: normalizeEmailValue(email),
        source: "directory",
      });
    }
    for (const email of entry.personalEmails ?? []) {
      identifiers.push({
        kind: "personal_email",
        value: normalizeEmailValue(email),
        source: "directory",
      });
    }
    for (const username of entry.usernames ?? []) {
      identifiers.push({
        kind: "username",
        value: username.trim(),
        source: "directory",
      });
    }
    seeds.push({
      key,
      displayName: entry.displayName,
      kind: "human",
      identifiers,
      directory: entry,
    });
    uf.add(seedNode(key));
  }

  // --- Seed declared service accounts (keyring.yml) ---
  for (const sa of serviceAccounts) {
    const key = `sa:${sa.id}`;
    const identifiers: Identifier[] = (sa.keyIds ?? []).map((value) => ({
      kind: "key_id" as const,
      value,
      source: "keyring.yml",
    }));
    seeds.push({
      key,
      displayName: sa.displayName,
      kind: "service_account",
      identifiers,
    });
    uf.add(seedNode(key));
  }

  for (const g of grants) {
    uf.add(grantNode(g.id));
  }

  const link = (
    a: string,
    b: string,
    signal: SignalKind,
    confidence: Confidence,
    detail: string,
  ) => {
    uf.union(a, b);
    edges.push({ a, b, signal, confidence, detail });
  };

  // Index directory for lookups
  const workEmailToSeed = new Map<string, string>();
  const personalEmailToSeed = new Map<string, string>();
  const usernameToSeed = new Map<string, string>();
  for (const seed of seeds) {
    for (const id of seed.identifiers) {
      if (id.kind === "work_email") workEmailToSeed.set(id.value, seed.key);
      if (id.kind === "personal_email") personalEmailToSeed.set(id.value, seed.key);
      if (id.kind === "username") {
        usernameToSeed.set(id.value.toLowerCase(), seed.key);
      }
    }
  }

  // Index grants by email / username / key
  const workEmailGrants = new Map<string, string[]>();
  const commitEmailGrants = new Map<string, string[]>();
  const personalEmailGrants = new Map<string, string[]>();
  const usernameGrants = new Map<string, string[]>();
  const keyGrants = new Map<string, string[]>();

  const pushMap = (map: Map<string, string[]>, key: string, grantId: string) => {
    const list = map.get(key) ?? [];
    list.push(grantId);
    map.set(key, list);
  };

  for (const g of grants) {
    for (const id of collectIdentifiers(g)) {
      if (id.kind === "work_email") pushMap(workEmailGrants, id.value, g.id);
      if (id.kind === "commit_email") pushMap(commitEmailGrants, id.value, g.id);
      if (id.kind === "personal_email") pushMap(personalEmailGrants, id.value, g.id);
      if (id.kind === "username") pushMap(usernameGrants, id.value.toLowerCase(), g.id);
      if (id.kind === "key_id") pushMap(keyGrants, id.value, g.id);
    }
  }

  // --- Signal 1: exact work-email match ---
  for (const [email, grantIds] of workEmailGrants) {
    for (let i = 1; i < grantIds.length; i++) {
      link(
        grantNode(grantIds[0]!),
        grantNode(grantIds[i]!),
        "work_email_exact",
        "certain",
        `Both grants carry work email ${email}`,
      );
    }
    const seedKey = workEmailToSeed.get(email);
    if (seedKey) {
      for (const gid of grantIds) {
        link(
          grantNode(gid),
          seedNode(seedKey),
          "work_email_exact",
          "certain",
          `Grant work email ${email} matches directory for ${seeds.find((s) => s.key === seedKey)?.displayName}`,
        );
      }
    }
  }

  // --- Signal 2: commit email ↔ work email ---
  for (const [email, grantIds] of commitEmailGrants) {
    const workPeers = workEmailGrants.get(email) ?? [];
    const seedKey = workEmailToSeed.get(email);
    for (const gid of grantIds) {
      for (const peer of workPeers) {
        if (peer === gid) continue;
        link(
          grantNode(gid),
          grantNode(peer),
          "commit_email_matches_work",
          "certain",
          `Commit email ${email} equals work email on another grant`,
        );
      }
      if (seedKey) {
        link(
          grantNode(gid),
          seedNode(seedKey),
          "commit_email_matches_work",
          "certain",
          `Commit email ${email} matches directory work email for ${seeds.find((s) => s.key === seedKey)?.displayName}`,
        );
      }
    }
  }

  // --- Signal 3: personal email in org directory ---
  for (const [email, grantIds] of personalEmailGrants) {
    const seedKey = personalEmailToSeed.get(email);
    if (!seedKey) continue;
    for (const gid of grantIds) {
      link(
        grantNode(gid),
        seedNode(seedKey),
        "personal_email_in_directory",
        "certain",
        `Personal email ${email} is listed on the directory record for ${seeds.find((s) => s.key === seedKey)?.displayName}`,
      );
    }
  }

  // Exact username listed on directory (stronger than fuzzy similarity)
  for (const [username, grantIds] of usernameGrants) {
    const seedKey = usernameToSeed.get(username);
    if (!seedKey) continue;
    for (const gid of grantIds) {
      link(
        grantNode(gid),
        seedNode(seedKey),
        "username_in_directory",
        "certain",
        `Username ${username} is listed on the directory record for ${seeds.find((s) => s.key === seedKey)?.displayName}`,
      );
    }
  }

  // --- Signal 4: username similarity — probable only; never if ambiguous ---
  for (const [username, grantIds] of usernameGrants) {
    if (usernameToSeed.has(username)) continue; // already exact
    const hits: Array<{ seedKey: string; score: number }> = [];
    for (const seed of seeds) {
      const score = usernameNameSimilarity(username, seed.displayName);
      if (score >= USERNAME_SIMILARITY_THRESHOLD) {
        hits.push({ seedKey: seed.key, score });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    // Ambiguous if two directory people both clear the threshold
    if (hits.length !== 1) continue;
    const hit = hits[0]!;
    for (const gid of grantIds) {
      // Only attach if this grant isn't already tied to a *different* seed via certain edges
      const root = uf.find(grantNode(gid));
      const conflicting = seeds.some(
        (s) => s.key !== hit.seedKey && uf.find(seedNode(s.key)) === root,
      );
      if (conflicting) continue;
      link(
        grantNode(gid),
        seedNode(hit.seedKey),
        "username_similarity",
        "probable",
        `Username "${username}" resembles directory name "${seeds.find((s) => s.key === hit.seedKey)?.displayName}" (score ${hit.score.toFixed(2)}); never treated as certain`,
      );
    }
  }

  // --- Signal 5: key/token attribution ---
  const attributionIndex = new Map<string, KeyAttribution>();
  for (const ka of keyAttributions) {
    attributionIndex.set(ka.keyId, ka);
  }
  // Also parse evidence claims for simple "attributed to X" patterns in raw
  for (const g of grants) {
    for (const id of collectIdentifiers(g)) {
      if (id.kind !== "key_id") continue;
      const attr = attributionIndex.get(id.value);
      if (!attr) continue;
      const target = resolveAttributionTarget(
        attr.attributedTo,
        workEmailToSeed,
        usernameToSeed,
        seeds,
      );
      if (!target) continue;
      link(
        grantNode(g.id),
        seedNode(target),
        "key_attribution",
        "probable",
        `Key ${id.value} attributed to ${attr.attributedTo} via ${attr.source}`,
      );
    }
  }

  // --- keyring.yml service accounts: link by key_id and/or resource_id ---
  for (const sa of serviceAccounts) {
    const seedKey = `sa:${sa.id}`;
    for (const g of grants) {
      const keyHit = (sa.keyIds ?? []).some((kid) =>
        g.principal.identifiers.some((i) => i.kind === "key_id" && i.value === kid),
      );
      // A shared resource can have both a human collaborator and a service
      // account deploy key. Resource ownership alone must not override an
      // explicit human principal; use resource IDs only for non-human grants.
      const resHit = g.principal.kind !== "human" && (sa.resourceIds ?? []).includes(g.resource.id);
      if (!keyHit && !resHit) continue;
      link(
        grantNode(g.id),
        seedNode(seedKey),
        "key_attribution",
        "certain",
        `Declared service account "${sa.displayName}" (owner ${sa.owner}) in keyring.yml`,
      );
    }
  }

  // --- Signal 6: temporal correlation with onboarding ---
  for (const seed of seeds) {
    const onboardedAt = seed.directory?.onboardedAt;
    if (!onboardedAt) continue;
    const center = Date.parse(onboardedAt);
    if (Number.isNaN(center)) continue;
    const seedRootGrants = [...byId.keys()].filter(
      (gid) => uf.find(grantNode(gid)) === uf.find(seedNode(seed.key)),
    );
    // Only use temporal for grants not yet linked to any seed
    for (const g of grants) {
      if (!g.createdAt) continue;
      const already = seeds.some((s) => uf.find(grantNode(g.id)) === uf.find(seedNode(s.key)));
      if (already) continue;
      const delta = Math.abs(g.createdAt.getTime() - center);
      if (delta > windowDays * MS_PER_DAY) continue;
      // Ambiguity: how many directory people share this window?
      const candidates = seeds.filter((s) => {
        if (!s.directory?.onboardedAt) return false;
        const t = Date.parse(s.directory.onboardedAt);
        return Math.abs(g.createdAt!.getTime() - t) <= windowDays * MS_PER_DAY;
      });
      if (candidates.length !== 1 || candidates[0]!.key !== seed.key) continue;
      // Only attach weak identifiers (key_id / unknown username) — never override certainty gaps for emails
      const ids = collectIdentifiers(g);
      const onlyWeak =
        ids.length > 0 &&
        ids.every((i) => i.kind === "key_id" || i.kind === "username" || i.kind === "display_name");
      if (!onlyWeak) continue;
      link(
        grantNode(g.id),
        seedNode(seed.key),
        "temporal_onboarding",
        "speculative",
        `Grant createdAt ${g.createdAt.toISOString()} falls within ${windowDays}d of ${seed.displayName}'s onboarding ${onboardedAt}; sole candidate in that window`,
      );
    }
    void seedRootGrants;
  }

  // --- Emit clusters (only those with ≥1 grant, anchored to a seed OR grant-only email clump) ---
  const clusters: IdentityCluster[] = [];
  const assigned = new Set<string>();

  // Directory-anchored clusters
  for (const seed of seeds) {
    const root = uf.find(seedNode(seed.key));
    const grantIds = grants.map((g) => g.id).filter((gid) => uf.find(grantNode(gid)) === root);
    if (grantIds.length === 0) continue;
    for (const gid of grantIds) assigned.add(gid);

    const clusterEdges = edges.filter((e) => uf.find(e.a) === root && uf.find(e.b) === root);
    const confidence = clusterEdges.reduce<Confidence>(
      (acc, e) => weaker(acc, e.confidence),
      "certain",
    );
    const identifiers = mergeIdentifiers(
      seed.identifiers,
      grantIds.map((gid) => byId.get(gid)!),
    );
    clusters.push({
      id: sha256Hex(`cluster:${seed.key}:${grantIds.slice().sort().join(",")}`),
      kind: seed.kind,
      displayName: seed.displayName,
      personId: asPersonId(sha256Hex(`person:${seed.key}`)),
      identifiers,
      grantIds: grantIds as GrantId[],
      confidence: clusterEdges.length === 0 ? "certain" : confidence,
      reasoning: buildReasoning(seed.displayName, clusterEdges, grantIds.length),
    });
  }

  // Grant-only clumps that share work email but have no directory seed
  const leftoverGroups = uf.groups(grants.map((g) => grantNode(g.id)));
  for (const [, nodes] of leftoverGroups) {
    const grantIds = nodes
      .map((n) => n.replace(/^grant:/, ""))
      .filter((gid) => !assigned.has(gid) && byId.has(gid));
    if (grantIds.length === 0) continue;

    // Only promote to a cluster if certain work-email links exist among them
    const groupEdges = edges.filter(
      (e) =>
        grantIds.some((gid) => e.a === grantNode(gid) || e.b === grantNode(gid)) &&
        (e.signal === "work_email_exact" || e.signal === "commit_email_matches_work"),
    );
    if (groupEdges.length === 0) continue;

    // Skip if any node is already in a seed cluster
    if (grantIds.some((gid) => assigned.has(gid))) continue;

    const sample = byId.get(grantIds[0]!)!;
    const work = collectIdentifiers(sample).find((i) => i.kind === "work_email");
    const kind = sample.principal.kind === "service_account" ? "service_account" : "human";
    const displayName = work?.value ?? `Unresolved ${kind} cluster`;
    for (const gid of grantIds) assigned.add(gid);
    clusters.push({
      id: sha256Hex(`orphan-cluster:${grantIds.slice().sort().join(",")}`),
      kind,
      displayName,
      identifiers: mergeIdentifiers(
        [],
        grantIds.map((gid) => byId.get(gid)!),
      ),
      grantIds: grantIds as GrantId[],
      confidence: "certain",
      reasoning: buildReasoning(displayName, groupEdges, grantIds.length),
    });
  }

  // Service-account named clusters: principal.kind === service_account with shared key prefix — still require signals; otherwise unknown

  const unknownIds = grants.map((g) => g.id).filter((gid) => !assigned.has(gid));
  const unknown: UnknownBucket = {
    grantIds: unknownIds as GrantId[],
    reasoning:
      unknownIds.length === 0
        ? "All grants were attributed to a cluster via an explicit signal chain."
        : `${unknownIds.length} grant(s) could not be attributed with the available signals (work email, commit email, directory personal email/username, non-ambiguous username similarity, key attribution, or unique onboarding window). Left in unknown rather than guessed into a person — these are the scariest findings.`,
  };

  clusters.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { clusters, unknown };
}

function resolveAttributionTarget(
  attributedTo: string,
  workEmailToSeed: Map<string, string>,
  usernameToSeed: Map<string, string>,
  seeds: SeedCluster[],
): string | undefined {
  const email = normalizeEmailValue(attributedTo);
  if (workEmailToSeed.has(email)) return workEmailToSeed.get(email);
  const uname = attributedTo.trim().toLowerCase();
  if (usernameToSeed.has(uname)) return usernameToSeed.get(uname);
  // Service account id from keyring.yml
  const saKey = `sa:${attributedTo.trim()}`;
  if (seeds.some((s) => s.key === saKey)) return saKey;
  const byName = seeds.filter(
    (s) => s.displayName.toLowerCase() === attributedTo.trim().toLowerCase(),
  );
  if (byName.length === 1) return byName[0]!.key;
  return undefined;
}

function mergeIdentifiers(base: Identifier[], grants: Grant[]): Identifier[] {
  const map = new Map<string, Identifier>();
  for (const id of base) {
    map.set(`${id.kind}:${id.value.toLowerCase()}`, id);
  }
  for (const g of grants) {
    for (const id of collectIdentifiers(g)) {
      map.set(`${id.kind}:${id.value.toLowerCase()}`, id);
    }
  }
  return [...map.values()].sort((a, b) =>
    `${a.kind}:${a.value}`.localeCompare(`${b.kind}:${b.value}`),
  );
}

function buildReasoning(displayName: string, clusterEdges: Edge[], grantCount: number): string {
  if (clusterEdges.length === 0) {
    return `Cluster for ${displayName} with ${grantCount} grant(s); no cross-link edges recorded.`;
  }
  // Deduplicate by signal+detail
  const seen = new Set<string>();
  const steps: string[] = [];
  const order: SignalKind[] = [
    "work_email_exact",
    "commit_email_matches_work",
    "personal_email_in_directory",
    "username_in_directory",
    "username_similarity",
    "key_attribution",
    "temporal_onboarding",
  ];
  const sorted = [...clusterEdges].sort(
    (a, b) => order.indexOf(a.signal) - order.indexOf(b.signal),
  );
  for (const e of sorted) {
    const key = `${e.signal}:${e.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    steps.push(`(${e.confidence}) ${signalLabel(e.signal)}: ${e.detail}`);
  }
  return (
    `Attributed ${grantCount} grant(s) to ${displayName}. Inference chain: ` + steps.join(" → ")
  );
}

/** JSON-friendly serialize (dates as ISO). */
export function serializeReconciliationResult(result: ReconciliationResult): unknown {
  return result;
}
