---
name: configuration-management
description: Make configuration explicit, validated and discoverable
keywords: config, settings, environment, defaults
kinds: implement, review
---

# Configuration Management

## When to use

Adding or restructuring configuration.

## Checklist

- Give every option a documented default that works out of the box.
- Validate configuration at load time with a schema; fail fast with a clear message.
- Keep secrets out of config files: use the OS keychain or an environment variable.
- Make normalisation pure and idempotent so reload is safe.
- Ship a committed, commented template so users can see what exists.

## Verification

- Start with an empty config and confirm sane defaults apply.
- Feed a malformed value and confirm the error names the field.
