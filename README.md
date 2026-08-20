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

## Build status

Early architecture and integration work. Mainnet evidence and deployed contracts will be recorded in `strk20.json` as they become available.

## Security

Never commit RPC keys, wallet secrets, viewing keys, private keys, or credentials. Use environment variables and `.env.local` for local secrets.

## License

MIT — see `LICENSE`.
