---
name: error-handling
description: Fail loudly, recover deliberately, never swallow
keywords: error, exception, catch, failure, resilience
kinds: implement, review
---

# Error Handling

## When to use

Adding or reviewing failure paths.

## Checklist

- Handle errors where you can actually recover; otherwise let them propagate.
- Never catch-and-ignore. An empty catch block is a defect.
- Preserve the original error as the cause when wrapping.
- Distinguish expected failures (validation) from unexpected ones (bugs) in both type and logging.
- Include the operation and its inputs in the message; exclude secrets.
- Make the user-facing message actionable; keep the diagnostic detail in logs.

## Verification

- Trigger each error path and confirm the message identifies the cause.
- grep for empty catch blocks in the touched files.
