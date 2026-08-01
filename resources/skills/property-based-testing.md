---
name: property-based-testing
description: Assert invariants over generated input
keywords: property, fuzz, invariant, generative
kinds: implement
---

# Property Based Testing

## When to use

Code with a broad input space and a clear invariant.

## Checklist

- State the invariant in one sentence before writing the generator.
- Prefer round-trip properties (encode/decode, normalise twice): they are cheap and strong.
- Constrain generators to realistic input; unbounded noise finds uninteresting failures.
- Pin any counterexample the runner finds as a permanent regression test.
- Keep run counts low enough that the suite stays fast.

## Verification

- Run with a fixed seed and confirm reproducibility.
- Confirm the property fails when the invariant is deliberately broken.
