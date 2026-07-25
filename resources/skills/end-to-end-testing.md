---
name: end-to-end-testing
description: Exercise the real user path through the whole system
keywords: e2e, playwright, browser, user flow
kinds: implement
---

# End To End Testing

## When to use

Validating a critical user journey.

## Checklist

- Cover the few journeys whose failure is unacceptable; do not e2e everything.
- Drive the app the way a user does — visible text and roles, not internal selectors.
- Wait on state, never on fixed timeouts.
- Make each test create its own data and clean up after itself.
- Capture a screenshot or trace on failure to make triage possible.

## Verification

- Run the suite twice and confirm no flakiness.
- Confirm a deliberately broken flow fails the test.
