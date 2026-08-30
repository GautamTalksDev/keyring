# Agent identity governance

AI agents are principals with delegated authority. Treating an agent as a
generic service account hides the runtime, tools, purpose, human owner, and
credentials that make its actions possible. Keyring gives an agent its own
principal kind so that this information remains visible beside human and
service-account access.

## Why this matters

The OWASP Top 10 for Agentic Applications 2026 was published on 9 December 2025. It names ASI03, Identity and Privilege Abuse, and ASI10, Rogue Agents,
among its ten categories. Both categories describe failures that an ordinary
employee access review can miss: an agent can retain delegated credentials,
reach an unexpected tool, or continue operating outside its declared purpose.

Recent research gives the problem scale:

- SailPoint and Dimensional Research report that 80 percent of organizations
  have seen agents take actions beyond their intended scope, 92 percent say
  agent governance is critical, and 44 percent report having a policy for
  agents. See the [SailPoint research summary](https://www.sailpoint.com/press-releases/sailpoint-ai-agent-adoption-report).
- Non-human identities commonly outnumber human identities by 45 to 1, with
  cloud environments sometimes reaching 100 to 1 or more. The
  [Cloud Security Alliance non-human identity governance paper](https://labs.cloudsecurityalliance.org/wp-content/uploads/2026/05/CSA%5Fwhitepaper%5Fnonhuman%5Fidentity%5Fagentic%5Fai%5Fgovernance%5Fv1-csa-styled.pdf)
  discusses these ratios and their lifecycle implications.
- GitGuardian found approximately 24 million new secrets in public GitHub
  repositories during 2024 and reported that 70 percent of valid secrets
  detected in 2022 remained active in its 2025 retest. See the
  [State of Secrets Sprawl 2025 report](https://blog.gitguardian.com/the-state-of-secrets-sprawl-2025-pr/).
  These are exposed credentials, not a count of agents, but they show why
  credential attribution and rotation cannot be optional.

The [NIST NCCoE concept paper on software and AI agent identity and
authorization](https://www.nccoe.nist.gov/sites/default/files/2026-02/accelerating-the-adoption-of-software-and-ai-agent-identity-and-authorization-concept-paper.pdf),
published in February 2026, identifies four minimum architecture areas:
identification, authorization, access delegation, and logging and
transparency. Keyring addresses the inventory and evidence needed to make
those controls reviewable.

## What Keyring inventories

The agent identity connector accepts records from readable sources. It does
not invent access to provider APIs.

- TrueForge MCP server registrations show an agent name, runtime, registration
  owner, reachable MCP tools, and registration evidence.
- Automation identities, service accounts, and tokens can be represented when
  a readable source attributes them to an agent.
- GitHub App installations can identify an automation principal and its
  permissions when the configured MCP source exposes that data.
- OAuth grants can identify non-human clients when the source supplies the
  client identity, scope, and evidence.

The connector has fixture and MCP source contracts. A customer may provide a
live adapter implementing the same contract. Keyring explicitly does not
claim to support an external provider API unless a configured source returns
the record. Agent identity records are inventory-only in the current
connector, so changing the underlying credential remains the responsibility
of the source connector.

Every resulting grant has evidence with a claim, source, confidence, and
optional locator. The evidence says how Keyring knows the agent exists and
what it can reach.

## Policy and attribution

Declare agents in `keyring.yml`:

```yaml
declared_agents:
  - id: billing-reconciler
    name: "Billing Reconciler"
    runtime: "TrueForge"
    owner: "owner@example.test"
    purpose: "Reconcile billing grants"
    agent_ids:
      - billing-reconciler
    tools:
      - billing-mcp
```

Declarations require a named owner and a stated purpose. Reconciliation uses
exact agent identifiers and declared credential identifiers. It never turns a
human directory match into an agent match, and it never attaches an agent
grant to a service-account cluster merely because both touch the same
resource.

An agent discovered without a declaration is an unregistered agent. An
unregistered agent holding live access receives a dedicated high-risk reason,
cannot be auto-approved, and is surfaced as an unattributed finding. Keyring
also inventories its own TrueForge registration and MCP reach. The tool that
governs access is therefore subject to the same review as every other agent.

## OWASP and NIST mapping

For ASI03, Keyring makes the agent principal, credential identifier,
reachable tools, capability, and evidence visible. Exact attribution and
separate read and write credential types reduce the chance that delegated
authority is mistaken for human authority.

For ASI10, Keyring compares discovered agents with declared owners and
purposes. Unregistered agents receive the highest risk treatment, remain in
the queue, and cannot be silently approved. The append-only audit ledger
records the resulting human decisions and execution results.

For NIST NCCoE identification, Keyring records stable agent identifiers,
runtime metadata, and registration evidence. For authorization, it displays
the capability and reachable tools associated with each grant. For access
delegation, policy records the responsible human owner without merging that
owner with the agent principal. For logging and transparency, evidence,
decisions, and audit records preserve the attribution chain.

Keyring is an inventory and approval layer. It does not replace provider
authorization, credential rotation, runtime isolation, or an emergency agent
shutdown control.
