---
name: observability-design
description: Make production debuggable before it breaks
keywords: logging, metrics, tracing, monitoring, alerts
kinds: plan, implement
---

# Observability Design

## When to use

Adding a service or a critical path.

## Checklist

- Log structured events with a stable schema, not free-form strings.
- Include a correlation id that follows the request across boundaries.
- Measure the four signals that matter: latency, traffic, errors, saturation.
- Alert on user-visible symptoms, not on internal causes.
- Never log secrets or personal data.
- Make log level configurable at runtime.

## Verification

- Trigger a failure and confirm the logs alone identify the cause.
- Confirm a correlation id links the whole request path.
