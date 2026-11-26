#!/usr/bin/env python3
"""
Alpha wallet diagnosis for Web Wallet import problems (Discord #193).

Collects ONLY non-secret facts about an Alpha Node (Qt or alphad) wallet:
wallet type, which address types and derivation paths hold funds, and how
the funds are spread across addresses. It does this by calling alpha-cli
with a fixed allow-list of read-only RPC commands.

It never asks for, reads or prints private keys, seed phrases, xpubs,
descriptors' key material, wallet passwords or the wallet.dat file.
Addresses are shortened by default; --full-addresses shows them in full.

Usage:
    python3 diagnose_wallet.py [--cli PATH] [--wallet NAME] [--full-addresses]

Requires the node to be running with the RPC server enabled
(alpha-qt: add `server=1` to alpha.conf and restart). Standard library only.
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone

# Read-only RPCs this script may call. Anything else is refused, so the script
# cannot be edited by accident into dumping keys (dumpprivkey, dumpwallet,
# listdescriptors true, ...).
ALLOWED = {
    "getnetworkinfo", "getblockchaininfo", "listwallets", "getwalletinfo",
    "listdescriptors", "listunspent", "listreceivedbyaddress", "getaddressinfo",
}

SAT = 100_000_000
DUST_WEB = 1000  # Web Wallet scan hides addresses at or below this many satoshis


class RpcError(Exception):
    pass


def make_rpc(cli, wallet):
    def rpc(method, *params):
        if method not in ALLOWED:
            raise RpcError(f"refusing non-allow-listed RPC '{method}'")
        if method == "listdescriptors" and params:
            raise RpcError("listdescriptors is only allowed without arguments (no private keys)")
        cmd = [cli]
        if wallet and method not in ("getnetworkinfo", "getblockchaininfo", "listwallets"):
            cmd.append(f"-rpcwallet={wallet}")
        cmd.append(method)
        cmd += [json.dumps(p) if not isinstance(p, str) else p for p in params]
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        except FileNotFoundError:
            raise RpcError(f"alpha-cli not found at '{cli}' (use --cli PATH)")
        except subprocess.TimeoutExpired:
            raise RpcError(f"{method}: timed out")
        if out.returncode != 0:
            raise RpcError(f"{method}: {out.stderr.strip() or out.stdout.strip()}")
        text = out.stdout.strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text
    return rpc


def short(addr, full):
    if full:
        return addr
    tag = hashlib.sha256(addr.encode()).hexdigest()[:6]
    return f"{addr[:10]}…{addr[-4:]} [{tag}]"


def address_kind(addr, info):
    if info.get("iswitness"):
        v = info.get("witness_version")
        if v == 0 and len(info.get("witness_program", "")) == 40:
            return "P2WPKH (native segwit, alpha1q…)"
        if v == 0:
            return "P2WSH"
        if v == 1:
            return "P2TR (taproot)"
        return f"witness v{v}"
    if info.get("isscript"):
        return "P2SH (wrapped/script)"
    return "P2PKH (legacy)"


def bucket(sats):
    if sats <= DUST_WEB:
        return f"<= {DUST_WEB} sat (hidden by Web Wallet scan)"
    if sats < SAT:
        return "< 1 ALPHA"
    if sats < 100 * SAT:
        return "1-100 ALPHA"
    return ">= 100 ALPHA"


def path_verdict(path, ischange):
    """What the Web Wallet would need to find this address."""
    if not path:
        return "no HD path (imported or non-HD key): Web Wallet import must read it as an individual key"
    p = path.replace("h", "'")
    parts = p.split("/")
    if len(parts) == 6 and parts[1] == "84'":
        idx = int(parts[5])
        chain = "change" if parts[4] == "1" else "receive"
        where = f"BIP84 {chain} #{idx}"
        notes = []
        if chain == "change":
            notes.append("found only with 'scan change addresses' ticked")
        if idx >= 100:
            notes.append("beyond the default 100-address scan")
        return where + (" — " + "; ".join(notes) if notes else " — inside the default Web Wallet scan")
    if len(parts) == 4 and parts[1] in ("0'", "0") and parts[2] in ("0'", "1'"):
        return "legacy Bitcoin Core HD path (m/0'/0'/k'): NOT scanned by the Web Wallet"
    return f"other path {p}: not scanned by the Web Wallet"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cli", default=shutil.which("alpha-cli") or "alpha-cli", help="path to alpha-cli")
    ap.add_argument("--wallet", default=None, help="wallet name, if the node has several loaded")
    ap.add_argument("--full-addresses", action="store_true", help="print addresses in full (default: shortened)")
    ap.add_argument("--out", default="alpha-wallet-diagnosis.txt", help="report file to write")
    a = ap.parse_args()

    rpc = make_rpc(a.cli, a.wallet)
    lines = []
    say = lambda s="": (print(s), lines.append(s))
    problems = []

    say("Alpha wallet diagnosis (Discord #193) — no keys, seeds or wallet files are read")
    say(f"generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%SZ')}")
    say()

    try:
        net = rpc("getnetworkinfo")
        chain = rpc("getblockchaininfo")
        say(f"node: {net.get('subversion')} (protocol {net.get('protocolversion')}), "
            f"chain {chain.get('chain')}, height {chain.get('blocks')}, "
            f"synced {'yes' if not chain.get('initialblockdownload') else 'NO (still syncing)'}")
        wallets = rpc("listwallets")
        say(f"loaded wallets: {len(wallets)}")
        if len(wallets) > 1 and not a.wallet:
            say("  several wallets loaded: re-run with --wallet <name> for each one")
            say("  names: " + ", ".join(str(w) or "(default)" for w in wallets))
            return 2
        w = rpc("getwalletinfo")
    except RpcError as e:
        say(f"ERROR: {e}")
        say("Is the node running with server=1? See the README for the Qt console alternative.")
        return 1

    descriptors = bool(w.get("descriptors"))
    say()
    say("== wallet type ==")
    say(f"format: {w.get('format', 'unknown')}  descriptors: {descriptors}  "
        f"hd: {'yes' if (descriptors or w.get('hdseedid')) else 'no'}  "
        f"encrypted: {'yes' if 'unlocked_until' in w else 'no'}  "
        f"private keys enabled: {w.get('private_keys_enabled')}")
    if descriptors:
        kind = "descriptor wallet (modern)"
    elif w.get("hdseedid"):
        kind = "legacy HD wallet (hdseed, paths m/0'/0'/k')"
    else:
        kind = "legacy non-HD wallet (independent random keys)"
    say(f"=> {kind}")
    say(f"tx count: {w.get('txcount')}  keypool size: {w.get('keypoolsize')}")

    if descriptors:
        try:
            d = rpc("listdescriptors")
            say()
            say("== descriptors (types and origin paths only; key material removed) ==")
            for desc in d.get("descriptors", []):
                s = desc.get("desc", "")
                typ = s.split("(", 1)[0]
                origin = s.split("[", 1)[1].split("]", 1)[0] if "[" in s else ""
                origin_path = "m/" + origin.split("/", 1)[1] if "/" in origin else "(none)"
                chain_ = "change" if desc.get("internal") else "receive"
                say(f"  {typ:<8} {chain_:<8} origin {origin_path:<16} "
                    f"active {desc.get('active')}  next index {desc.get('next', desc.get('next_index', '?'))}")
        except RpcError as e:
            say(f"  (could not list descriptors: {e})")

    try:
        utxos = rpc("listunspent", 0)
        received = rpc("listreceivedbyaddress", 0, True)
    except RpcError as e:
        say(f"ERROR: {e}")
        return 1

    per_addr = {}
    for u in utxos:
        addr = u.get("address")
        if not addr:
            continue
        e = per_addr.setdefault(addr, {"sats": 0, "utxos": 0, "unconfirmed": 0})
        e["sats"] += round(u["amount"] * SAT)
        e["utxos"] += 1
        if u.get("confirmations", 0) == 0:
            e["unconfirmed"] += 1
    ever = {r["address"] for r in received if r.get("amount", 0) > 0 or r.get("txids")}

    say()
    say(f"== funded addresses: {len(per_addr)} (addresses that ever received funds: {len(ever)}) ==")
    total = 0
    rows = []
    for addr, e in per_addr.items():
        try:
            info = rpc("getaddressinfo", addr)
        except RpcError as err:
            info = {}
            problems.append(f"getaddressinfo failed for {short(addr, a.full_addresses)}: {err}")
        path = info.get("hdkeypath", "")
        rows.append((path or "~", addr, e, info))
        total += e["sats"]
    rows.sort()
    for path, addr, e, info in rows:
        path = "" if path == "~" else path
        say(f"- {short(addr, a.full_addresses)}")
        say(f"    type: {address_kind(addr, info)}   change: {info.get('ischange')}   "
            f"mine: {info.get('ismine')}   watch-only: {info.get('iswatchonly')}")
        say(f"    path: {path or '(none)'}")
        say(f"    web wallet: {path_verdict(path, info.get('ischange'))}")
        say(f"    balance: {bucket(e['sats'])}   utxos: {e['utxos']}"
            + (f"   unconfirmed utxos: {e['unconfirmed']}" if e["unconfirmed"] else ""))
        if not address_kind(addr, info).startswith("P2WPKH"):
            problems.append(f"{short(addr, a.full_addresses)} is {address_kind(addr, info)}: the Web Wallet only handles alpha1q (P2WPKH)")
        elif not path:
            problems.append(f"{short(addr, a.full_addresses)} has no HD path: only found if the import keeps every individual key")
        elif not path_verdict(path, info.get("ischange")).startswith("BIP84"):
            problems.append(f"{short(addr, a.full_addresses)} is on {path}: outside the BIP84 path the Web Wallet scans")
        elif "default 100-address" in path_verdict(path, info.get("ischange")) or info.get("ischange"):
            problems.append(f"{short(addr, a.full_addresses)}: {path_verdict(path, info.get('ischange'))}")
        if e["sats"] <= DUST_WEB:
            problems.append(f"{short(addr, a.full_addresses)} holds <= {DUST_WEB} sat: hidden by the Web Wallet scan")

    say()
    say(f"total in funded addresses: {bucket(total)} across {sum(e['utxos'] for e in per_addr.values())} utxos")
    say()
    say("== likely reasons the Web Wallet shows fewer addresses ==")
    if problems:
        for p in problems:
            say(f"- {p}")
    else:
        say("- none from the wallet side: every funded address is a BIP84 alpha1q address the scan should reach.")
        say("  Compare with the Web Wallet: tick 'scan change addresses', and note any address it shows with no balance.")

    try:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        print(f"\nReport saved to {a.out}. Please send that file (or the text above).")
    except OSError as e:
        print(f"\n(could not write {a.out}: {e}; copy the text above instead)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
