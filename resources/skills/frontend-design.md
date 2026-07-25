---
name: frontend-design
description: Build UI that is clear before it is clever
keywords: ui, component, layout, react, frontend
kinds: implement, review
---

# Frontend Design

## When to use

Building or changing user interface.

## Checklist

- Establish hierarchy: one primary action per view, everything else visibly secondary.
- Use consistent spacing, type scale and colour tokens rather than ad-hoc values.
- Design the empty, loading, error and overflow states alongside the happy path.
- Keep components presentational where possible; push data fetching to the edges.
- Make interactive elements keyboard reachable and clearly focusable.
- Test at a narrow width — layout breaks show up there first.

## Verification

- View the change at 320px, 768px and 1440px.
- Navigate the whole flow with the keyboard only.
