# Connected portfolio aggregation handoff

**Status:** local X2 domain/API contract; no live balance or price provider is wired by the default factory.

## Route

```http
GET /api/v1/portfolio/:prismId
```

The route returns the normal Prism success/error envelope. Every response contains explicit `BASE`, `STARKNET`, and `STRK20` branches. Each branch carries:

```text
state: loading | empty | observed | stale | unavailable | partial | unknown
authoritativeSource
observedAt
freshness: fresh | stale | unknown
coverage: none | partial | complete
assetUnitCompatibility: compatible | incompatible | unknown
assets
```

`BASE` and `STARKNET` accounts are queried only after the injected public binding/resolution authority returns an explicit destination for that venue. Address equality, aliases, funding graphs, transaction timing, clustering, and other heuristics are not ownership evidence.

## Private STRK20 boundary

The private branch is `PRIVATE` and is `unknown` with `PORTFOLIO_CONSENT_REQUIRED` unless the caller supplies:

```http
X-Privacy-Wallet-Consent: granted
X-Privacy-Wallet-Session-Ref: <opaque-reference>
```

The private provider receives only the Prism context and the granted consent capability. The projection allow-list contains balances/assets only; viewing keys, private keys, notes, raw proofs, provider responses, and private account material never cross the application boundary. A denied consent remains explicit and is never treated as an empty private balance.

## Totals and valuation

`total` is `null` unless at least one observed, unit-compatible asset has a successful **fresh** result from the injected valuation source. Values are summed as decimal strings only when they share a quote currency. Failed, stale, unknown, or incompatible items are excluded and listed in `total.excludedAssets`; a non-null partial total is labeled `coverage: "partial"`. No balance, price, currency, or total is hard-coded.

## Default factory and evidence ceiling

The default memory/Postgres factories leave `portfolioService` unset, so the route fails closed with `PORTFOLIO_UNAVAILABLE` until explicit providers are injected. `createIsolatedFactory(..., { portfolioService })` is the supported X2 test seam. This implementation proves local contracts and redaction only; it does not prove live Base/Starknet RPC reads, wallet consent UX, price-source freshness, durable portfolio persistence, or production deployment.
