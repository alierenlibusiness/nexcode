---
name: design-system
description: Make one visual language the codebase actually follows
keywords: design system, tokens, theme, consistency
kinds: plan, implement, review
---

# Design System

## When to use

Introducing or extending shared UI foundations.

## Checklist

- Define tokens for colour, spacing, type and radius; forbid raw values in components.
- Build a component once, in one place, with variants rather than copies.
- Support light and dark from the token layer, not per component.
- Document each component's intended use and its states.
- Deprecate the old component when the new one lands; do not keep both.

## Verification

- grep for hard-coded colours and spacing in the touched files.
- Render each component in both themes.
