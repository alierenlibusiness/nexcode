---
name: api-design
description: Design an interface that is predictable and hard to misuse
keywords: api, rest, endpoint, interface, contract
kinds: plan, implement, review
---

# Api Design

## When to use

Adding or changing a public interface.

## Checklist

- Model resources and their state transitions before choosing verbs and paths.
- Make the common case trivial and the dangerous case explicit.
- Use consistent naming, casing and pluralisation across every endpoint.
- Return a stable, documented error shape with a machine-readable code.
- Design pagination, filtering and sorting once and apply them uniformly.
- Make writes idempotent where a retry is plausible.

## Verification

- Walk a client through the three most common flows using only the interface.
- Confirm the error shape is identical across endpoints.
