---
name: threat-modeling
description: Enumerate what an attacker would try first
keywords: threat, attack surface, stride, risk
kinds: plan, research
---

# Threat Modeling

## When to use

Designing a feature that handles sensitive data or actions.

## Checklist

- Draw the trust boundaries and the data crossing each one.
- For each boundary ask: spoofing, tampering, repudiation, disclosure, denial, elevation.
- Rank threats by realistic impact times likelihood, not by novelty.
- Name the mitigation for each accepted threat and where it lives in code.
- Explicitly record the threats you are choosing not to mitigate, and why.

## Verification

- Every high-ranked threat maps to a named mitigation or an accepted-risk note.
