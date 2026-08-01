<div align="center">

# CLI Discovery and Hybrid Execution

**Find the coding CLIs already on the machine, then run them, or fall back to an API.**

</div>

---

## What this branch is about

NEXCODE has no agents of its own. It uses the ones you already installed and already pay
for. That only works if it can find them reliably on three operating systems and a dozen
package managers.

## Discovery

`PATH` is not enough. Coding CLIs get installed through npm, pnpm, Yarn, Bun, Volta, Scoop,
WinGet, Chocolatey, Homebrew and plain Unix prefixes, and several of those do not touch a
shell `PATH` an Electron process inherits.

Discovery scans all of them, then builds an agent profile per CLI it finds: command, default
autonomous arguments, capabilities, orchestration role and timeout metadata.

Known adapters: `claude`, `codex`, `gemini`, `opencode`, `antigravity`. Anything else becomes
`custom` and still works, just without catalog-backed model handling.

## Profile repair

Configuration files get hand-edited, copied between machines and carried across upgrades.
A profile saying `adapter: claude` with `cmd: codex` will send Claude flags to Codex and fail
in a way that is genuinely hard to diagnose.

So a recognized command name **outrules** a conflicting adapter field. On conflict the target
CLI's defaults are installed and the stale model override is dropped. This runs at startup,
at config save and before every invocation, so a broken profile repairs itself rather than
failing repeatedly.

Custom wrapper commands that carry no recognizable CLI name keep whatever adapter was set
explicitly, since guessing there would break legitimate setups.

## Model priority

```
explicit agent override  >  cliSettings[adapter].model  >  CLI account default
```

An auto-discovered profile's model suggestion does **not** count as an override. Only a
deliberate user choice (`modelOverride: true`) beats the global setting. Without that rule,
a background rediscovery silently overwrites the model you picked.

If a profile already contains an explicit `--model` argument, nothing is added, so no
duplicate flags.

## Health checks

Readiness is measured by running the CLI, not by checking whether a file exists.

Health checks use the same prompt materialization as a real run, including temporary prompt
files for adapters that read from disk, and clean those files up on every exit path. A check
that behaves differently from a real invocation tells you nothing.

Failures are classified rather than lumped together: auth required, auth invalid, rate limit,
quota exhausted, model overloaded, network error, region blocked, provider unavailable, CLI
not found, timeout, stalled, version incompatible.

That classification drives recovery. Transient failures retry on the same agent. Permanent
ones quarantine it for the session and fail the work over to another healthy agent.

## Silence timeouts

Different CLIs go quiet for different lengths of time while still working. Killing on a
single global timeout either wastes minutes or murders healthy long runs.

| Adapter | Silence limit |
|---|---|
| codex, gemini | 180s |
| claude | 240s |
| opencode | 300s |

A stall is reported honestly: "no new output for a long time", not "the CLI never ran". The
distinction matters when an agent produced real work before going quiet.

## Hybrid execution

CLI orchestration is the core, but API providers remain a second execution path:

- Anthropic, OpenAI-compatible and Google adapters
- API keys in the OS keychain, never in a file
- Per-call cost logging split by connection mode
- Quota tracking so `cli_first` agents fall back to API when a subscription window fills

You get subscription economics by default and API reliability when the subscription runs out.

## Files

```
packages/core/src/providers/cli/
  adapters.ts     per-CLI specs, argument construction, prompt materialization
  discovery.ts    filesystem and package manager scanning
  health.ts       readiness probes and failure classification
  runner.ts       process execution
packages/core/src/providers/
  registry.ts pricing.ts cost.ts quota.ts factory.ts
  anthropic.ts openai-compatible.ts google.ts
```

## Verify

```bash
pnpm test --filter providers
pnpm test --filter cli
```
