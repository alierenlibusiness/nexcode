---
name: docs-api-reference
description: Document every parameter, response and failure
keywords: api docs, reference, parameters, examples
kinds: implement
---

# Docs Api Reference

## When to use

Documenting a programmatic interface.

## Checklist

- Document every parameter: type, whether required, default, and constraints.
- Document every response including errors and their codes.
- Give a copy-pasteable request and its real response for each endpoint.
- State authentication and rate limits once, prominently.
- Generate from the schema where possible so it cannot drift.

## Verification

- Copy each example and run it against a real server.
- Diff the documented shape against the schema.
