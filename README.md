<div align="center">

# Verification Gate

**A model saying "the tests pass" is not evidence. A green command is.**

</div>

---

## The problem

Ask any coding agent whether its work is done and it will tell you yes. Ask it to review its
own output and it will usually approve. The whole quality loop in most agent systems rests on
a sentence the model generated, which is exactly the thing you cannot verify by generating
more sentences.

## What this branch adds

After every round of agent work, and **before** any completion decision, NEXCODE runs the
commands you actually use.

```jsonc
{
  "verify": {
    "commands": ["pnpm typecheck", "pnpm test", "pnpm lint"],
    "timeoutSeconds": 600,
    "maxOutputChars": 6000,
    "blockOnFailure": true,
    "maxAttempts": 2
  }
}
```

Commands run fail-fast in the task's working directory. The first red command stops the run;
there is no point running lint when typecheck is already broken.

## What a red gate does

A failing gate is not a log line. It changes what the engine is allowed to do:

| Shortcut | Green gate | Red gate |
|---|---|---|
| FAST mode early completion | allowed | closed |
| PASS fast path (skip second operator call) | allowed | closed |
| Review loop governor | allowed | closed |
| Operator says "complete" | delivered | **rejected once** |

That last row is the important one. If the operator decides to ship anyway while the gate is
red, the decision is rejected and a correction round is forced. The rejection is logged and
surfaced in the UI.

## What a red gate does not do

It does not delete work.

If the operator comes back a second time still wanting to complete, the task ships with the
gate result written into its verification summary and its remaining risk. Two hours of agent
output are never discarded because one test stayed red. You get the work, plus an honest
record of what is broken.

`maxAttempts` controls how many times the gate may block. `blockOnFailure: false` turns the
gate into pure reporting.

## Evidence, not a status code

The operator does not just learn that something failed. It gets the output:

```
## Doğrulama kapısı

Durum: KIRMIZI

### pnpm test [DÜŞTÜ]

​```
FAIL src/auth/login.test.ts
  expected 401, received 500
​```

Kapı kırmızı. Kestirme teslimat yapma: düşen komutu geçirecek düzeltmeyi planla veya
sorunun neden giderilemediğini kalan riskte açıkça belirt.
```

Long output is clipped from the middle, never the end. Test runners put the summary last, so
tail-clipping would throw away the part that matters.

## Off by default

With `verify.commands` empty the gate never runs, never spawns a process, and behavior is
byte-for-byte identical to a build without it. Opting in is a deliberate choice.

## Files

```
packages/core/src/verify/verify-gate.ts        the gate
packages/core/src/verify/verify-gate.test.ts   gate behavior
packages/core/src/engine/engine-verify.test.ts engine integration contracts
apps/desktop/src/process-ports.ts              real process execution
```

## Verify

```bash
pnpm test --filter verify
```

The integration tests cover the cases that matter: the gate is skipped when unconfigured, a
green gate leaves the fast path intact, a red gate closes it, a stubborn operator is rejected
exactly once, and the work still ships on the second attempt.

## License

MIT. See [`LICENSE`](LICENSE).
