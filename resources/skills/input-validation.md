---
name: input-validation
description: Validate at the boundary, trust nothing from outside
keywords: validation, sanitize, schema, boundary, untrusted
kinds: implement, review
---

# Input Validation

## When to use

Any code that accepts external input.

## Checklist

- Validate at the trust boundary (API handler, IPC, form submit), not deep inside.
- Use a schema validator and derive the type from the schema, not the reverse.
- Reject unknown fields explicitly rather than silently dropping them, unless stripping is intended.
- Enforce length, range and format limits — unbounded input is a denial-of-service vector.
- Normalise before comparing (case, unicode, whitespace, path separators).
- Return field-level errors the caller can act on.

## Verification

- Send a malformed payload and confirm a 4xx with a useful message.
- Send an oversized payload and confirm it is rejected.
