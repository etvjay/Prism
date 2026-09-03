# Prism

**One Prism ID. One home across chains.**

Prism is a Starknet-native identity and financial coordination protocol. A persistent Prism ID anchors identity and continuity on Starknet while connected accounts on Base and other venues remain native execution identities. STRK20 provides Prism's first private financial state and private Starknet execution surface.

## Private Sprint build

This repository is being built for the STRK20 Private Sprint.

Initial proof target:

1. Create a persistent Prism ID on Starknet.
2. Connect and prove control of a Base execution account.
3. Bind, resolve, and revoke that account without changing the Prism ID.
4. Show real Starknet + Base financial state in one interface.
5. Surface a real STRK20 private balance and execute qualifying private Starknet actions on mainnet.

## Product boundaries

Prism is not a bridge or solver network. Native chains remain native execution venues. Cross-chain value movement requires a real execution route and will not be presented as automatic unless it is actually implemented.

Privacy claims are venue-specific: STRK20 provides the first real private financial environment for Prism; ordinary Base transactions remain public unless a separate privacy mechanism is integrated.

## Roadmap

**Core v1 closeout:** Registry V2, persistent Prism identity, Base ownership proof and binding, resolve/revoke lifecycle, pause/governance controls, durable operation handling, and truthful Home/operation surfaces.

**The larger Prism direction:** STRK20 remains a first-class product expansion in this repository. The planned privacy surface includes wallet-mediated private state, private Starknet actions, and meaningful pool-integrated product flows. It is intentionally visible here as the next major integration rather than being treated as a separate project.

**Current status:** Core v1 is locally implemented with an X2 overall preparation ceiling; separately scoped testnet identity/projection facts are recorded at X3 in `projects/prism/EVIDENCE_LEDGER.md`. Mainnet preparation is documented in `projects/prism/MAINNET_PREPARATION_HANDOFF.md` and `docs/MAINNET_READINESS_STATUS.md`; it remains fail-closed pending owner approval, protected credentials, live receipts, and independent readback. STRK20 remains hard-gated on a real Wallet API/prover session, pool action, private-state readback, accepted receipt, conservation, and independent verification. Mainnet claims and `strk20.json` entries will be added only from observed evidence.

Vesu lending, LayerZero delivery, PrismChannel beyond the minimal relationship slice, shadow accounts, and broader private financial capabilities remain future expansion tracks.

## Security

Never commit RPC keys, wallet secrets, viewing keys, private keys, or credentials. Use environment variables and `.env.local` for local secrets.

## License

MIT — see `LICENSE`.
