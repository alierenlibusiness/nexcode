<div align="center">

# Safety and Approvals

**Autonomy you can bound, on a machine you care about.**

</div>

---

## What this branch is about

NEXCODE runs coding agents autonomously against a real filesystem with real credentials. The
features here exist so that is a reasonable thing to do.

## Consent is required

The engine cannot start until autonomous operation has been explicitly accepted.

```ts
if (config.autonomousConsentAcceptedAt === null) {
  return abort(task, "The engine cannot start without autonomous operation consent.");
}
```

Checked at the IPC boundary and again inside the engine. Not a dialog that sets a variable
somewhere: a persisted timestamp that gates every run.

## Risky plans stop for a human

When `approvalMode: "ask"`, a plan matching any configured risk pattern is queued for
approval before a single agent starts.

The plan text is hashed. If the queued plan changes between the request and the decision, the
approval no longer applies. You approve a specific plan, not a slot in a queue.

Risk patterns are yours to define: `git push`, `--force`, `rm -rf`, `DROP TABLE`, `.env`,
production deploys, whatever your project cannot afford.

## Agents write where you allow

```jsonc
{
  "sandbox": {
    "mode": "workspace",
    "extraWritableDirs": ["/path/to/sibling-package"]
  }
}
```

In `workspace` mode an agent can only write inside the working directory. No Docker and no
git required. Monorepos add specific sibling paths rather than opening the whole disk.

## Secrets stay out of everything

API keys live in the OS keychain. Never in a config file, never in the database, never in
plain text on disk.

`.env` files, credentials and private keys are excluded from:

- live diff event payloads
- checkpoint snapshot contents
- the Live Code view

A sensitive file is recorded as "this exists" and nothing more. Restore leaves it alone
rather than overwriting your working secrets with a stale copy.

## Budgets

```jsonc
{
  "dailyCallBudget": 150,
  "quota": { "windowHours": 5, "maxCallsPerWindow": 50 }
}
```

The daily call budget is checked before a task starts and fed by every operator and
specialist call, so a runaway loop stops at a number you chose. The rolling quota window
tracks subscription usage so `cli_first` agents fall back to API instead of hammering a CLI
that is already rate limited.

Every call is logged with its connection mode, so subscription usage and API spend are
separable rather than one blended number.

## Human approval, always

Regardless of autonomy level, these never happen without a person:

- `git push` and force-push
- branch or file deletion
- direct pushes to `main`
- production deployment
- `.env` changes
- irreversible migrations
- package removal

## Reversibility

Checkpoints make every task undoable, and undoing is itself undoable. Worktree isolation
means a task that goes wrong never touched your working tree in the first place. Restore is
refused while the engine is busy so files are never pulled out from under a running agent.

## Transparency

Every decision is an event, persisted and replayable. You can open a finished task and read
the operator's plan, each delegation, each review verdict, the verification output, and the
exact lines that changed. Not a summary of what happened: the record.

## Files

```
packages/core/src/approval/gate.ts       risk detection and approval flow
packages/core/src/sandbox/sandbox.ts     workspace write containment
packages/core/src/security/              keychain-backed secret storage
packages/core/src/engine/live-diff.ts    sensitive path exclusion and size limits
packages/core/src/providers/quota.ts     rolling subscription window
packages/core/src/db/approval-repo.ts    approval queue
```

## Verify

```bash
pnpm test --filter gate
pnpm test --filter sandbox
pnpm test --filter live-diff
```

## License

MIT. See [`LICENSE`](LICENSE).
