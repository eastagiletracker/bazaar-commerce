# Contributing

Thank you for considering a contribution.

## Before you start

Open an issue describing the problem before writing a large change. This repo has
strong opinions about money handling, and it is kinder to discuss an approach
than to review a finished branch that has to be rewritten.

Small fixes, documentation improvements and additional test coverage need no
discussion. Send them.

## Getting set up

See [docs/quickstart.md](docs/quickstart.md). You need Node 20+, bun and Docker.

## The one rule that matters

**Prove your test can fail.**

Every suite in this repository was checked by deliberately breaking the code it
covers and confirming the test went red. A test that cannot fail manufactures
confidence, which is worse than no test at all. Several real bugs here were found
precisely because a passing test was distrusted and mutated.

When you add a test:

1. Write it and see it pass.
2. Break the code it covers.
3. Confirm it fails, and that the failure message would tell you what is wrong.
4. Restore the code.

Say in your pull request how you broke it. "Reverted the SKIP LOCKED claim to a
read-then-write and checks 14 through 16 went red" is exactly the right level of
detail.

## Standards

- **TypeScript.** Run `npx tsc --noEmit` in `packages/api`. It must be clean;
  CI gates on it. The storefront carries 121 type errors inherited from the
  upstream starter and builds with `ignoreBuildErrors`; do not add more.
- **Comments explain why.** If a line encodes a decision, record what the
  alternative was and why it lost. The existing code is written this way and it
  is the main reason it is maintainable.
- **No em-dashes** in user-facing copy.
- **Idempotency.** Anything that can be delivered twice must be keyed on a
  business fact, not a random id. Order events *are* delivered twice.
- **Money is append-only.** Corrections are reversing ledger entries, never
  edits.

## Commit messages

Explain the reasoning, not just the change. If you found something surprising,
put it in the message; that is where the next person will look. Reference the
issue if there is one.

## Pull requests

- One logical change per pull request.
- Run the suites covering what you touched, and say which you ran.
- Update the docs in the same pull request. Documentation drift is a bug.
- New known limitations go in `docs/known-issues.md`. We would rather publish a
  defect than have someone discover it in production.

## Areas where help is especially welcome

- Courier integrations beyond Pakistan: remittance file formats and tracking
  webhooks for other cash-on-delivery markets.
- Payment providers for markets Stripe Connect does not serve.
- Localisation, particularly right-to-left languages.
- The three open issues in `docs/known-issues.md`.

## Licence

By contributing you agree that your contribution is licensed under Apache-2.0,
as set out in [LICENSE](LICENSE).
