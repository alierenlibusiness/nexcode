---
name: integration-testing
description: Verify components work together across real boundaries
keywords: integration, database, api, boundary
kinds: implement, review
---

# Integration Testing

## When to use

Verifying a path that crosses a module, process or storage boundary.

## Checklist

- Test the real seam: real database, real serialisation, real IPC.
- Set up and tear down state per test so ordering never matters.
- Assert on the observable outcome, not on intermediate internals.
- Cover the failure modes of the boundary: timeout, malformed response, partial write.
- Keep the suite runnable on a clean machine with one command.

## Verification

- Run the suite twice in a row and confirm both pass.
- Run a single test in isolation and confirm it still passes.
