#!/usr/bin/env python3
"""Read-only LayerZero testnet prerequisite gate.

This intentionally does not load private keys or broadcast. RPC URLs are read
only inside the process and are never printed.
"""
from __future__ import annotations
import json, os, stat, sys, urllib.request
from pathlib import Path

RPC_FILE = Path('/home/ubuntu/.hermes/cache/documents/doc_8447dade1e5e_starknet_rpc.env')
ACCOUNT_FILE = Path('/home/ubuntu/.starknet_accounts/starknet_open_zeppelin_accounts.json')
BASE_SIGNER = Path('/home/ubuntu/.config/prism/wallets/base-sepolia-ownership-eoa.json')

def fail(msg: str) -> None:
    print(f'BLOCKED: {msg}')
    raise SystemExit(2)

def mode(path: Path) -> str:
    return format(stat.S_IMODE(path.stat().st_mode), 'o')

def main() -> None:
    if not RPC_FILE.is_file(): fail(f'missing protected Starknet RPC file: {RPC_FILE}')
    if mode(RPC_FILE) != '600': fail(f'protected Starknet RPC file mode is {mode(RPC_FILE)}, expected 600')
    rpc = None
    for line in RPC_FILE.read_text().splitlines():
        fields = line.split()
        if len(fields) == 3 and fields[0] == 'sn_testnet' and fields[1] == '=':
            rpc = fields[2]
    if not rpc or not rpc.startswith('https://') or 'invalid' in rpc.lower():
        fail('sn_testnet RPC entry is missing, non-HTTPS, or placeholder')
    assert rpc is not None
    req = urllib.request.Request(rpc, data=json.dumps({'jsonrpc':'2.0','id':1,'method':'starknet_chainId','params':[]}).encode(), headers={'content-type':'application/json'})
    result = None
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            result = json.load(response).get('result')
    except Exception as exc:
        fail(f'SN_SEPOLIA RPC probe failed: {type(exc).__name__}: {exc}')
    if result != '0x534e5f5345504f4c4941': fail(f'SN_SEPOLIA chain ID mismatch: {result!r}')
    if not ACCOUNT_FILE.is_file(): fail(f'missing Starknet account file: {ACCOUNT_FILE}')
    if mode(ACCOUNT_FILE) != '600': fail(f'Starknet account file mode is {mode(ACCOUNT_FILE)}, expected 600')
    account = json.loads(ACCOUNT_FILE.read_text())
    if 'alpha-sepolia' not in account or 'prism_sepolia_deployer' not in account['alpha-sepolia']:
        fail('required alpha-sepolia/prism_sepolia_deployer account entry missing')
    if not BASE_SIGNER.is_file(): fail(f'missing Base signer file: {BASE_SIGNER}')
    if mode(BASE_SIGNER) != '600': fail(f'Base signer file mode is {mode(BASE_SIGNER)}, expected 600')
    signer = json.loads(BASE_SIGNER.read_text())
    if signer.get('network') != 'base-sepolia' or str(signer.get('chainId')) != '84532':
        fail('Base signer metadata is not base-sepolia / chain ID 84532')
    if not os.environ.get('BASE_SEPOLIA_RPC_URL'):
        fail('no protected BASE_SEPOLIA_RPC_URL supplied; public/guessed RPC endpoints are prohibited')
    print('PASS: protected paths, modes, signer metadata, and SN_SEPOLIA RPC chain identity validated')

if __name__ == '__main__': main()
