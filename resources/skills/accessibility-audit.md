---
name: accessibility-audit
description: Make the interface usable without sight or a mouse
keywords: a11y, accessibility, screen reader, wcag, aria
kinds: review, implement
---

# Accessibility Audit

## When to use

Reviewing or building any interface.

## Checklist

- Use semantic elements first; ARIA is a patch, not a foundation.
- Give every control an accessible name and every image meaningful alt text.
- Confirm full keyboard operability with a visible focus indicator and no traps.
- Check contrast: 4.5:1 for body text, 3:1 for large text and UI boundaries.
- Never encode meaning in colour alone.
- Announce dynamic changes with a live region where the user needs to know.

## Verification

- Tab through the whole flow and confirm every step is reachable and visible.
- Run an automated a11y checker and triage the findings.
