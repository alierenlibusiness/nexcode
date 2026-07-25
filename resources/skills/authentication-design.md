---
name: authentication-design
description: Prove identity without creating new attack surface
keywords: auth, login, session, token, oauth, password
kinds: plan, implement, review
---

# Authentication Design

## When to use

Building or changing a login path.

## Checklist

- Use a vetted library or provider; never hand-roll password hashing or token signing.
- Hash passwords with a memory-hard algorithm and a per-user salt.
- Make sessions expire, rotate on privilege change, and be revocable server-side.
- Set cookies HttpOnly, Secure and SameSite; keep tokens out of localStorage.
- Rate-limit and lock out after repeated failures; make the response timing uniform.
- Treat account recovery as an authentication path — it is the usual way in.

## Verification

- Confirm an expired and a revoked session are both rejected.
- Confirm failure responses do not reveal whether the account exists.
