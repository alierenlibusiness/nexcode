---
name: graphql-design
description: Design a graph that resolves efficiently
keywords: graphql, schema, resolver, n+1
kinds: plan, implement, review
---

# Graphql Design

## When to use

Adding or reviewing GraphQL schema.

## Checklist

- Design types around the domain, not around a single screen's needs.
- Make nullability meaningful; non-null is a promise you must keep.
- Batch and cache at the data-loader level to avoid N+1 resolution.
- Bound list fields with pagination; never expose an unbounded list.
- Use a deprecation directive instead of removing a field.

## Verification

- Run the query with tracing and confirm no N+1 pattern.
- Confirm the schema passes the project's lint rules.
