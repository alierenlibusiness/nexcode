---
name: database-schema-design
description: Model data so invalid states cannot be stored
keywords: database, schema, table, index, normalization
kinds: plan, implement, review
---

# Database Schema Design

## When to use

Adding or changing persistent structure.

## Checklist

- Let constraints enforce invariants: NOT NULL, UNIQUE, CHECK, foreign keys.
- Choose the narrowest correct type; avoid text for structured values.
- Index for the queries you actually run, and confirm with a query plan.
- Decide the delete behaviour explicitly — cascade, restrict or set null.
- Store timestamps in UTC with an explicit type.
- Do not denormalise before measuring a real problem.

## Verification

- Attempt to insert an invalid row and confirm the database rejects it.
- Run EXPLAIN on the main query and confirm the index is used.
