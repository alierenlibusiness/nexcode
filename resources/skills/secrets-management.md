---
name: secrets-management
description: Keep credentials out of code, logs and backups
keywords: secret, credential, api key, keychain, vault
kinds: implement, review
---

# Secrets Management

## When to use

Handling any credential.

## Checklist

- Store secrets in the OS keychain or a secret manager, never in a config file or repo.
- Keep them out of logs, error messages, telemetry and crash dumps.
- Scope each credential to the least privilege it needs.
- Make rotation possible without a code change.
- Scan history before publishing; a rotated secret in git history is still leaked.

## Verification

- grep the diff and logs for key-shaped strings.
- Confirm the secret scanner passes on the full history.
