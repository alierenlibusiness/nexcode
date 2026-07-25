---
name: cli-design
description: Design a command line that is guessable
keywords: cli, command line, flags, ux, terminal
kinds: plan, implement, review
---

# Cli Design

## When to use

Adding or changing a command line interface.

## Checklist

- Follow platform conventions: --long, -s, --help, --version.
- Make the default behaviour safe; require a flag for destructive action.
- Write errors to stderr and data to stdout so piping works.
- Use meaningful exit codes.
- Support --json for machine consumption where output is structured.
- Make --help complete enough to use without the docs.

## Verification

- Run --help and confirm every flag is documented.
- Pipe the output into another command and confirm it parses.
