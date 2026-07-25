---
name: security-review
description: Find the vulnerabilities a change actually introduces
keywords: security, vulnerability, injection, xss, audit
kinds: review
---

# Security Review

## When to use

Reviewing a change that touches auth, input, storage or external calls.

## Checklist

- Follow untrusted input from entry to sink; every sink needs the right escaping.
- Check authentication and authorisation separately — being logged in is not being allowed.
- Look for injection: SQL, command, path traversal, template, prototype pollution.
- Confirm secrets are not logged, echoed, committed or sent to a third party.
- Check that errors do not leak internal structure to the client.
- Verify cryptographic choices use a vetted library, never a hand-rolled scheme.

## Verification

- Attempt one concrete exploit per finding and record the result.
- Run the project's dependency audit.
