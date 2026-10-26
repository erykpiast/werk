# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: map-69-70.spec.ts >> 70.5 A second view sees the accept because it reads the same log
- Location: .werk-heldout/e2e/map-69-70.spec.ts:207:1

# Error details

```
Error: locator.click: Target page, context or browser has been closed
Call log:
  - waiting for getByRole('button', { name: '✓' })

```

```
Error: write EPIPE
```

```
Error: browserContext.close: Target page, context or browser has been closed
```