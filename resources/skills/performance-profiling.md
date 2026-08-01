---
name: performance-profiling
description: Measure before optimising, then measure again
keywords: performance, profile, slow, latency, benchmark
kinds: implement, research
---

# Performance Profiling

## When to use

A concrete slowness complaint or a measured regression.

## Checklist

- Reproduce the slowness with a repeatable measurement first.
- Profile to find where time actually goes; do not optimise from intuition.
- Fix the dominant cost first: a 5% win beside a 10x hotspot is wasted work.
- Prefer algorithmic and I/O wins over micro-optimisation.
- Watch for N+1 queries, unbatched I/O and work inside render loops.
- Record the before and after numbers in the delivery report.

## Verification

- Report the measured before/after with the same method and input.
- Confirm correctness tests still pass after the optimisation.
