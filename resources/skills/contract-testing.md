---
name: contract-testing
description: Pin the agreement between a producer and a consumer
keywords: contract, schema, api compatibility, pact
kinds: implement, review
---

# Contract Testing

## When to use

Two sides that must agree on a payload shape.

## Checklist

- Write the contract as executable schema, not prose.
- Test both directions: the producer emits it, the consumer accepts it.
- Cover optional fields and their absence, not just the full payload.
- Fail the build when the contract changes without a version bump.
- Keep one source of truth for the schema; generate both sides from it.

## Verification

- Change the producer shape and confirm the contract test fails.
- Confirm both sides import the same schema definition.
