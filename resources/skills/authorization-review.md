---
name: authorization-review
description: Check that every action verifies permission at the right layer
keywords: authorization, permission, rbac, access control, idor
kinds: review
---

# Authorization Review

## When to use

Reviewing anything that returns or modifies another user's data.

## Checklist

- Verify authorisation server-side on every request; UI hiding is not enforcement.
- Check object-level access — the classic hole is a valid session reading another user's id.
- Confirm the check happens before the side effect, not after.
- Look for bulk endpoints and exports that skip the per-object check.
- Verify the default is deny; new routes must opt into access.

## Verification

- Call each endpoint with another user's object id and confirm a 403/404.
- Call each endpoint unauthenticated and confirm rejection.
