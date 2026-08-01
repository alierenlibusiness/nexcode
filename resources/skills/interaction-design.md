---
name: interaction-design
description: Make state changes legible and reversible
keywords: interaction, feedback, animation, affordance, ux
kinds: implement, review
---

# Interaction Design

## When to use

Designing behaviour rather than layout.

## Checklist

- Give every action immediate feedback; unacknowledged input feels broken.
- Show progress for anything over ~400ms and keep the UI responsive.
- Make destructive actions confirmable or undoable: prefer undo.
- Keep motion short, purposeful and honour prefers-reduced-motion.
- Preserve state across navigation so users do not lose work.

## Verification

- Trigger each action on a throttled connection and observe the feedback.
- Verify the flow with reduced motion enabled.
