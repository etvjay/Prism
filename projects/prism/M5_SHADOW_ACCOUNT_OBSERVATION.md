# M5 Optional Shadow-Account Observation

**Status:** optional provider observation only
**Source:** supplied `shadow-accounts_overview.pdf` observation; not a live provider readback
**Scope:** STRK20/M5 boundary; no route or evidence promotion

## Observation

The supplied overview describes a privacy-pool/anonymizer capability that may
create disposable Starknet execution accounts for private DeFi actions such as
Vesu or Endur.

This is recorded as a possible provider capability, not as a Prism-owned
account or a claim about the underlying privacy mechanism.

## Boundary

The canonical Prism route remains:

```text
Prism dapp → Wallet API / SNIP-36-capable provider → STRK20 pool
```

The optional observation is metadata-only:

```text
observeShadowAccountCapability() →
  supported | unsupported | unknown
  + disposable-execution-account capability
  + provider-reported protocol labels
```

Prism does not receive or retain a shadow-account address, account object,
viewing key, private key, note, proof, balance, or provider plaintext through
this observation. A missing, malformed, or unavailable observation leaves the
ordinary Wallet API route available and records `unknown` where appropriate.

## Explicit non-meanings

A shadow-account observation is **not** any of the following:

- a STRK20 note or memo;
- a claim or receipt;
- an identity binding or persistent execution endpoint;
- a mandatory M5 route or completion predicate;
- evidence of unlinkability, anonymity, or historical privacy.

The typed observation carries `privacyClaim: "not_claimed"`. The M5 runner may
record the observation for readiness/context, but it never uses it to promote
`M5_E2E_RUNNER_READY_X2` to `M5_E2E_SUCCESS_X3`.

## Evidence ceiling

The PDF is a research observation only. The local adapter/runner tests are
controlled X2 evidence. No live Wallet API capability, shadow-account
creation, SNIP-36 proof, pool receipt, note maturity, or independent readback
is claimed here. Full M5 remains blocked until the real wallet/prover and
receipt/readback predicates are observed.
