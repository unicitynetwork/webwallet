# Roadmap

This roadmap is the human-readable mirror of this project's GitHub Project board.
The two MUST stay in sync — run `/roadmap-sync` after landing work (the
`roadmap-sync-check` hook nudges you when a commit changed code without touching
this file). Each item below maps to one card on the board; the emoji encodes its
board status.

**Status legend (four-state model):**

| Emoji | Status | Meaning |
|-------|--------|---------|
| ✅ | Completed | Shipped / merged / done. |
| 🚧 | In progress | Actively being worked on right now. |
| ⏸️ | Stalled / paused | Started but on hold (blocked, deprioritized, awaiting input). |
| 🔵 | Planned | Agreed, not yet started. |

> Keep one item per line: `- <emoji> **<title>** — <short description>`.
> Add an optional `(#<issue>)` or `(PR #<n>)` reference when one exists.

## ✅ Completed

<!-- Move items here when shipped. -->

- ✅ **Sphere wallet import** — load a Sphere wallet from its recovery phrase or JSON export (incl. sphere-sdk `v2:` encryption); same addresses and keys as Sphere, verified with funded mainnet spends. (PR #6, v0.6.0)
- ✅ **Backups restore the saved address** — `DESCRIPTOR PATH` / `ADDRESS PATH` in `.txt` backups, save-time restore check, same scan order from phrase and file. (PR #7, v0.6.0)
- ✅ **Signing key always matches the address** — key/address invariant enforced on load, save, scan selection, display and signing; no private keys in the scan cache. (PR #7, v0.6.0)
- ✅ **Release v0.6.0** — published 2026-10-26.
- ✅ **Fix vesting/pending balance display after restore** — main balance and transaction toasts correct after a restore with unconfirmed change; confirmed on the funded mainnet wallet. (PR #8, v0.6.1)
- ✅ **Release v0.6.1** — published 2026-10-26.
- ✅ **Ask before sending debug reports** — confirmation names the destination and contents; sessions re-sanitized before sending. (PR #9)
- ✅ **Stop logging the master key on wallet.dat import** — no key material (master key, chain code, child keys, encrypted mkey, key prefixes) in the console. (PR #9)
- ✅ **Fix the Stop Scan button** — calls the scan's own flag via window.stopWalletScan(). (PR #9)
- ✅ **Release v0.6.2** — published 2026-10-28 (security hygiene: PR #9, #10).
- ✅ **Ember Card redesign** — new wallet UI by KruGoL with review fixes (key-check failure state, wallet stack, phrase grid, balances, pending pill); real-browser QA incl. real sends. (PR #11, #13)
- ✅ **Release v0.6.3** — published 2026-10-28 (Ember Card redesign).

## 🚧 In progress

<!-- What is actively being built right now. -->
- 🚧 **Remove committed debug scripts with real keys** — exposed mining wallet swept (85,565.03 ALPHA moved 2026-10-27); wallet .dat files untracked + *.dat ignored (PR #10); remaining: key-bearing scripts, *_wif.txt backups, index_0_1_2.html, README/alpha-migrate example WIF; 1 ALPHA left at alpha1qklt….
- 🚧 **Investigate Qt import and send gaps (Discord #193, #198)** — send planner fixed on fix/193-198: fewest transactions (single covering coin, else largest first) and every tx balances (old dust step could burn ~half a coin as fee or build an invalid tx); next: import every key/descriptor of a descriptor wallet (e.g. Qt-migrated legacy wallets), awaiting reporter diagnosis (tools/diagnose-wallet); Qt node side tracked in unicitynetwork/alpha#9.


## ⏸️ Stalled / paused

<!-- Started but on hold — note why (blocked on X, awaiting Y). -->

- ⏸️ **Restore L1 in Sphere behind a flag** — plan ready (optional sphere-sdk `l1` module + Sphere plugin, ~3 weeks); awaiting owner / Sphere-maintainer sign-off. Last L1 snapshots tagged `archive/l1-last`.
- ⏸️ **L1 → L3 bridge in Sphere** — needs a real bridge (vault deposit, receipts, mint) and a backend; depends on L1 in Sphere.

## 🔵 Planned

- 🔵 **Encrypt wallet data at rest** — wallets are stored in plaintext in localStorage/IndexedDB.
- 🔵 **Test Scanned Wallets dialog with several funded addresses** — plus old-Sphere import of a webwallet backup; not yet exercised.
