# Resolution aliases and continuity foundation

**Status:** additive backend foundation; no Product/System decision acceptance
**Scope:** provider-neutral alias contracts, Starknet ID adapter boundary, continuity comparison, and durable snapshots. No frontend, mainnet, secrets, or external-network observation is included.

## Boundary

`ExternalAlias` is an addressable value in an external namespace:

```text
ExternalAlias(provider, value) != PrismId
```

An `IdentityAliasProvider` may return provider evidence and a stable external
subject. It must not mint, parse, or infer a Prism ID. The service requires a
separate `IdentityAliasAssociationPort` result marked
`explicit_prism_association` before it calls the Prism binding resolver.

The Starknet ID integration is intentionally only a typed port:

```text
StarknetIdLookupPort.lookup(alias) -> provider record | null
```

`StarknetIdAliasProvider` has no default endpoint or RPC client. With no
explicitly supplied port it returns `BLOCKED_BY_INTERFACE_EVIDENCE`. A port
exception returns `UNAVAILABLE`, and a malformed record returns
`INVALID_RESPONSE`. These results are blocking; the continuity service never
uses an unverified alias as a destination.

## Continuity flow

```text
explicit Prism ID OR external alias
  -> provider evidence (for aliases)
  -> explicit alias/Prism association (for aliases)
  -> current binding destination
  -> scoped durable ResolutionSnapshot
  -> ResolutionDiff
  -> typed ResolutionRisk[]
```

Snapshots are scoped by `(prismId, venue, purpose)`. They are comparison
baselines, not canonical identity or binding state. Canonical registry reads
remain the source of current binding truth. The PostgreSQL adapter uses
parameterized SQL and create-only / optimistic-versioned writes; a version
conflict or storage failure blocks the continuity result.

## Typed risk behavior

The diff/risk layer exposes explicit fields and stable codes rather than an
opaque score:

- `FIRST_TIME_RECIPIENT` — no prior scoped snapshot;
- `ADDRESS_CHANGED` — destination address differs after normalization;
- `ALIAS_CHANGED` — provider/value or external subject differs after normalization;
- `CHAIN_CHANGED` — destination chain differs;
- `VISIBILITY_CHANGED` — visibility differs;
- `BINDING_REVOKED` — current binding is revoked; blocking;
- `NO_ACTIVE_DESTINATION` — no active destination is available; blocking.

An unchanged active resolution produces no new risks. Address, alias, chain, and
visibility changes are typed non-blocking observations for a later policy
consumer; revoked and no-active outcomes remain blocked. Provider, association,
resolution, and snapshot failures are represented as blocking `UNKNOWN` risks.

The continuity service returns `RESOLVED`, `NO_ACTIVE_DESTINATION`, or
`BLOCKED`, together with the current/previous snapshots and diff when a scoped
read was completed. No result asserts live provider connectivity or mainnet
state.

## Verification boundary

The tests use in-memory providers/stores and a mocked PostgreSQL pool only to
verify SQL shape and row boundaries. They do not contact Starknet ID, an RPC,
mainnet, or any external network. Product/System policy mappings remain open and
are not accepted by this foundation.
