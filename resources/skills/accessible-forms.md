---
name: accessible-forms
description: Forms that explain themselves and recover from error
keywords: form, label, validation, input, a11y
kinds: implement, review
---

# Accessible Forms

## When to use

Building or reviewing a form.

## Checklist

- Associate a visible label with every input; placeholder is not a label.
- Group related controls with a fieldset and legend.
- Show errors next to the field, describe the fix, and link them programmatically.
- Move focus to the first error on failed submit and announce it.
- Preserve entered values on failure; never clear the form.
- Set correct input types and autocomplete attributes.

## Verification

- Submit an empty form and navigate the errors with a screen reader.
- Confirm every input is reachable and labelled via keyboard.
