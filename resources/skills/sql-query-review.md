---
name: sql-query-review
description: Review a query for correctness and cost
keywords: sql, query, join, index, explain
kinds: review
---

# Sql Query Review

## When to use

Reviewing a non-trivial query.

## Checklist

- Read the query plan; do not judge cost by how the SQL looks.
- Check join conditions: a missing predicate is a silent cross join.
- Confirm NULL semantics in comparisons, NOT IN and aggregates.
- Verify the query is bounded: LIMIT, index-backed filter, no full scan on a large table.
- Check for injection: parameters must be bound, never concatenated.

## Verification

- Run EXPLAIN and report the access path.
- Run against a realistic row count, not an empty table.
