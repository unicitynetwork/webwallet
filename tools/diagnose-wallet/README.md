# Alpha wallet diagnosis (Discord #193)

Use this when the Web Wallet import shows fewer funded addresses than Alpha Node Qt.

The script collects **only non-secret facts** about the wallet:
- which kind of wallet it is (descriptor, legacy HD or legacy non-HD);
- which address types and derivation paths hold funds;
- how the funds are spread across addresses.

From those facts it explains which address the Web Wallet would miss, and why.

**It never reads private keys, seed phrases, xpubs, passwords or `wallet.dat`.** It can only run eight read-only RPC commands (`getnetworkinfo`, `getblockchaininfo`, `listwallets`, `getwalletinfo`, `listdescriptors` without private keys, `listunspent`, `listreceivedbyaddress`, `getaddressinfo`), and refuses anything else. Addresses are shortened by default (`alpha1qabc…wxyz [tag]`). Exact amounts are not printed, only ranges.

## Run it (Windows, macOS, Linux)

1. Keep Alpha Node Qt running. If `alpha-cli` can't connect, add `server=1` to `alpha.conf` and restart Qt:
   - **Windows:** `%APPDATA%\Alpha\alpha.conf`
   - **macOS:** `~/Library/Application Support/Alpha/alpha.conf`
   - **Linux:** `~/.alpha/alpha.conf`
2. Install Python 3 if needed (python.org). No other packages are required.
3. Run:
   ```
   python3 diagnose_wallet.py
   ```
   - If `alpha-cli` isn't on your PATH: `python3 diagnose_wallet.py --cli "C:\Program Files\Alpha\daemon\alpha-cli.exe"`
   - If several wallets are loaded: add `--wallet "<name>"`.
4. Send us the file it writes, `alpha-wallet-diagnosis.txt` (or the printed text).

Optional: `--full-addresses` prints the funded addresses in full. That lets us check them against the Fulcrum server, but it reveals which addresses are yours, so use it only if you're comfortable with that.

## No Python? Use the Qt console instead

In Alpha Node Qt, open **Window → Console** and paste these one at a time:

```
getwalletinfo
listaddressgroupings
```

Then, for **each** funded address from the second command:

```
getaddressinfo <address>
```

Send us, for each address, the fields `hdkeypath`, `ischange`, `iswitness` and `witness_version`, plus `descriptors` and `hdseedid` from `getwalletinfo`. **Never run or send `dumpprivkey`, `dumpwallet`, `listdescriptors true` or `walletpassphrase`**: nobody helping you needs them.

## What the answers tell us

| Result | Meaning for the Web Wallet |
|---|---|
| `legacy non-HD wallet` | The import keeps only one of the independent keys, so the others go missing. |
| `legacy HD wallet`, paths `m/0'/0'/k'` | Those addresses are on a path the Web Wallet doesn't scan. |
| `descriptor wallet`, path `…/1/k` | A change address: found only with "scan change addresses" ticked. |
| `descriptor wallet`, index ≥ 100 | Beyond the default 100-address scan. |
| balance `<= 1000 sat` | Hidden by the scan's dust filter. |
| type not P2WPKH | Address type the Web Wallet doesn't support. |
| none of the above | Wallet side is fine; the scan's balance lookup likely failed for that address. |
