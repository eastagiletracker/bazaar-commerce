## What this changes

<!-- and why. If it encodes a decision, say what the alternative was. -->

## How it was verified

<!-- Which suites did you run? -->

```
bun run test:...
```

## Proof the test can fail

<!--
The one rule in CONTRIBUTING.md. If you added or changed a test, break the code
it covers and confirm it goes red, then say so here. For example:

  "Reverted allocateCode to a read-then-write and checks 14-16 went red."

If this change adds no tests, say why not.
-->

## Checklist

- [ ] Docs updated in this same pull request
- [ ] New limitations added to `docs/known-issues.md`
- [ ] No `.env` committed
- [ ] `npx tsc --noEmit` clean in `packages/api`
