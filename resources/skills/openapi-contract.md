---
name: openapi-contract
description: Describe the HTTP surface precisely enough to generate from
keywords: openapi, swagger, spec, schema
kinds: implement, review
---

# Openapi Contract

## When to use

Documenting or generating from an HTTP API.

## Checklist

- Describe every response the endpoint can actually return, including errors.
- Use shared components for repeated shapes rather than duplicating them.
- Mark required fields honestly; optional-by-default hides bugs.
- Include realistic examples: they are what consumers read first.
- Validate the spec in CI and keep it in the same commit as the code.

## Verification

- Run an OpenAPI validator over the spec.
- Confirm a generated client compiles against the real server.
