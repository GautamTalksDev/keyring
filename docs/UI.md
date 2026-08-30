# Web interface

The web app is in `apps/web`. It shows scan progress beside the ApprovalCard queue.

## Scan activity

The left panel displays the scan status, connected systems, subagent progress, reconciliation state, costs, and event log. The API sends these updates over server sent events. Reconnecting to a scan receives the stored event history before new events.

## Approval queue

The queue puts unattributed findings first. Each card shows:

- Principal and confidence.
- Source system, capability, and resource.
- Created time and last used time.
- Risk score and the reasons behind it.
- Proposed action and whether the action is restorable.
- Protected and auto approval policy markers.
- The evidence chain used for attribution.

An operator can approve, hold with a note, or reject a pending card. Bulk approval never includes protected cards. Approval records intent only.

## Execute

Execution is a separate action. The confirmation view shows the approved cards, dry run state, permanent actions, and available undo hints. The UI displays streamed per card results after execution. Dry run is on by default.

## Guided demo

The replay demo shows **Run guided demo** only when the app is in demo or replay mode. It starts a replay scan, waits for the five system activity, holds the summary, approves safe cards one at a time, and stops at the protected CI card.

**Continue** records the hold note `belongs to CI, flag the owner`, then executes the approved cards through the API and finishes on the verified audit ledger. **Stop** aborts the local run, waits for any in flight decision request, resets decisions, and leaves the UI ready for another take. Append-only audit records remain available for review. The demo reset endpoint is available only when `KEYRING_DEMO=1`.

## Run the UI

For the local demo:

```bash
pnpm install
pnpm demo
```

For a separate API and UI:

```bash
pnpm -F @keyring/server dev
pnpm -F @keyring/web dev
```

Open http://localhost:5173. Use `VITE_API_PORT` when the API is not on port 3001.
