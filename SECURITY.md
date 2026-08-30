# Security policy

## Reporting a vulnerability

Email **security@cubitrek.com** with the details. Please do not open a public
issue for anything that touches money, digital codes, or authentication.

We will acknowledge within three working days and keep you updated. If you would
like credit in the release notes, say so and tell us how to name you.

## What we consider high severity

This project moves money and hands out bearer instruments, so the following are
treated as serious even without a full exploit chain:

- Any path that allocates the **same digital code to two orders**. Both buyers
  have paid, and a spent code cannot be made good.
- Any path that returns a **decrypted code** outside the buyer's reveal endpoint,
  or writes one to a log, an error message or a database column.
- Any path that **bypasses the fraud gate** in `lib/digital/deliver.ts` and
  delivers without an assessment.
- Any path that lets a seller **dispatch an unconfirmed or cancelled order**, or
  read another seller's orders, codes or payouts.
- Any **ledger** operation that posts unbalanced entries, double-posts on a
  replayed event, or makes uncollected cash look payable.
- Token forgery or enumeration on the order-confirmation and code-reveal links.
  These are unauthenticated by design; their security rests entirely on token
  entropy and correct scoping.

## Known and already documented

Please check [docs/known-issues.md](docs/known-issues.md) before reporting. Open
issues there are known, and a report duplicating one is still welcome but will be
closed as a duplicate.

## Handling secrets

- `PK_VAULT_KEY` encrypts the digital code vault and is deliberately **not** the
  session secret. Production refuses to start without it.
- Never commit a `.env`. Templates only.
- Development falls back to a fixed vault key. That key is in the source history
  and must never be used anywhere real.

## Scope

This policy covers the code in this repository. It does not cover deployments you
operate, nor the upstream Medusa and Mercur projects; report those to their
maintainers.
