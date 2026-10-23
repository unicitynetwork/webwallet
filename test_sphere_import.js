// Regression + unit tests for Sphere wallet import.
// Functions are extracted from index.html so the shipped file is what gets tested.
// Never prints mnemonics, seeds or private keys.
const fs = require('fs');
const path = require('path');
const CryptoJS = require('crypto-js');
const elliptic = require('elliptic');

const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

/** Extract a top-level `function NAME(...) { ... }` block by brace matching. */
function extractFunction(html, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(html);
  if (!m) throw new Error('function not found in index.html: ' + name);
  let i = html.indexOf('{', m.index + m[0].length - 1);
  if (i === -1) throw new Error('no body found for: ' + name);
  let depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) return html.slice(m.index, i + 1);
    }
  }
  throw new Error('unbalanced braces for: ' + name);
}

/** Extract a top-level `const NAME = ...;` single-line declaration. */
function extractConst(html, name) {
  const re = new RegExp('^\\s*const\\s+' + name + '\\s*=[^\\n]*$', 'm');
  const m = re.exec(html);
  if (!m) throw new Error('const not found in index.html: ' + name);
  return m[0].trim();
}

/**
 * Build a sandbox containing the named functions/consts from index.html.
 *
 * This evaluates source read from index.html in this repo. It is a local test
 * script and never ships to the browser; the point is to exercise the real
 * shipped code rather than a copy that can drift out of sync.
 */
function loadFromIndex(names, consts = []) {
  names = [...new Set(names)];
  if (consts.includes('SPHERE_DESCRIPTOR_PATH') && !consts.includes('LEGACY_DESCRIPTOR_PATHS')) {
    consts = [...consts, 'BIP32_MAX_INDEX', 'LEGACY_DESCRIPTOR_PATHS'];
  }
  const src = [
    ...consts.map((c) => extractConst(INDEX, c)),
    ...names.map((n) => extractFunction(INDEX, n)),
    'return { ' + names.join(', ') + ' };',
  ].join('\n\n');
  // eslint-disable-next-line no-new-func
  return new Function('CryptoJS', 'elliptic', src)(CryptoJS, elliptic);
}

let pass = 0;
let fail = 0;
function check(name, got, want) {
  if (got === want) {
    pass++;
    console.log('PASS  ' + name);
  } else {
    fail++;
    console.log('FAIL  ' + name + '\n      got:  ' + got + '\n      want: ' + want);
  }
}
async function checkThrows(name, fn, expectedSubstring) {
  try {
    await fn();
    fail++;
    console.log('FAIL  ' + name + '\n      expected throw containing: ' + expectedSubstring);
  } catch (e) {
    if (String(e.message).includes(expectedSubstring)) {
      pass++;
      console.log('PASS  ' + name);
    } else {
      fail++;
      console.log(
        'FAIL  ' + name + '\n      got error: ' + e.message + '\n      want substring: ' + expectedSubstring
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Ground truth: sphere-sdk tests/integration/wallet-derivation.test.ts
// Those wallets are documented there as "exported from webwallet".
// ---------------------------------------------------------------------------
const SDK_BIP32_WALLET = {
  masterKey: '44af427cc3e4eca15633682c50383df02f5598ff70ae972060b32529106efea3',
  chainCode: 'ef9b229fa43b5321834bce029dcca011db64764538f06e5b50b9dd5f38d16678',
  descriptorPath: "84'/1'/0'",
  expected: [
    'alpha1q64c7vmezvqd43l4g0hg8l72uttc0sc5cqrhpqz',
    'alpha1qpanlhfjynerdp3vwjfd6uctexa2n6c9pusnsja',
    'alpha1q8m2m2sele36p3js0ju8rfcrk4ynjylvjnjl4x7',
  ],
};
const SDK_WIF_WALLET = {
  masterKey: '86f38045ecb4f6ae0d655e866f13937b9892fbd1ff4b3ade8998df7422b4dd1b',
  expected: [
    'alpha1qr82m4mgx7ngy32cfr5jkrcrmqw4j4as8spu8al',
    'alpha1qm4x7zc4ewz058kszsut73x9ujrgt0vdw5fw3jr',
  ],
};

const DERIVATION_FNS = [
  'bytesToHex',
  'hexToBytes',
  'deriveKeyBIP32',
  'deriveHDPath',
  'bech32Polymod',
  'hrpExpand',
  'bech32Checksum',
  'convertBits',
  'createBech32',
  'deriveAddressAtIndex',
];

(async () => {
console.log('=== Existing derivation is unchanged (sphere-sdk vectors) ===');
{
  const w = loadFromIndex(DERIVATION_FNS, ['CHARSET']);
  SDK_BIP32_WALLET.expected.forEach((want, i) => {
    const r = w.deriveAddressAtIndex(
      SDK_BIP32_WALLET.masterKey,
      SDK_BIP32_WALLET.chainCode,
      i,
      true,
      false,
      SDK_BIP32_WALLET.descriptorPath
    );
    check('BIP32 index ' + i + ' (' + r.path + ')', r.address, want);
  });
  SDK_WIF_WALLET.expected.forEach((want, i) => {
    const r = w.deriveAddressAtIndex(SDK_WIF_WALLET.masterKey, null, i, true, false, null);
    check('HMAC index ' + i + ' (' + r.path + ')', r.address, want);
  });
}

console.log('\n=== BIP39 wordlist + validation ===');
{
  const w = loadFromIndex(['bip39NormalizeMnemonic', 'bip39ValidateMnemonic'], ['BIP39_WORDLIST']);
  const src = extractConst(INDEX, 'BIP39_WORDLIST');
  // eslint-disable-next-line no-new-func
  const list = new Function(src + '; return BIP39_WORDLIST;')();

  check('wordlist length', list.length, 2048);
  check('first word', list[0], 'abandon');
  check('last word', list[2047], 'zoo');
  check(
    'wordlist sha256 matches canonical english.txt',
    CryptoJS.SHA256(list.join('\n') + '\n').toString(),
    '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda'
  );

  const VALID_12 =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const VALID_24 =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ' +
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
  check('valid 12-word phrase', w.bip39ValidateMnemonic(VALID_12), true);
  check('valid 24-word phrase', w.bip39ValidateMnemonic(VALID_24), true);
  check(
    'mixed case and padding accepted',
    w.bip39ValidateMnemonic('  ABANDON  ' + VALID_12.split(' ').slice(1).join(' ') + ' '),
    true
  );
  check(
    'bad checksum rejected',
    w.bip39ValidateMnemonic(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon'
    ),
    false
  );
  check('unknown word rejected', w.bip39ValidateMnemonic(VALID_12.replace('about', 'zzzznotaword')), false);
  check('wrong word count rejected', w.bip39ValidateMnemonic('abandon abandon about'), false);
  check('empty string rejected', w.bip39ValidateMnemonic(''), false);
}

const BIP39_FNS = [
  'bip39NormalizeMnemonic',
  'bip39ValidateMnemonic',
  'bip39MnemonicToSeedHex',
  'masterKeyFromSeedHex',
  'sphereWalletFromMnemonic',
  // shared HD import helpers (buildHdWallet and what it, the JSON reader and the
  // backup resolver depend on)
  'parseFullAddressPath',
  'parseDescriptorPathFromText',
  'parseAddressPathFromText',
  'parseFirstAddressFromText',
  'addressFromPrivateKey',
  'findAddressInBranches',
  'resolveHdSelectionFromBackup',
  'pbkdf2Sha256',
  'decryptSphereValue',
  'normalizeDescriptorPath',
  'backupPathLines',
  'buildHdWallet',
  'checkWalletKeyIntegrity',
];
const VALID_12 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

console.log('\n=== BIP39 seed + master key (canonical vectors) ===');
{
  const w = loadFromIndex(BIP39_FNS, ['BIP39_WORDLIST', 'SPHERE_DESCRIPTOR_PATH']);

  // BIP39 canonical vector, empty passphrase (sphere-sdk tests/fixtures/test-vectors.ts)
  check(
    'seed matches BIP39 vector',
    w.bip39MnemonicToSeedHex(VALID_12),
    '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4'
  );

  // BIP32 canonical vector (sphere-sdk tests/fixtures/test-vectors.ts BIP32_VECTORS[0])
  const m = w.masterKeyFromSeedHex('000102030405060708090a0b0c0d0e0f');
  check(
    'master private key from seed',
    m.masterPrivateKey,
    'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35'
  );
  check(
    'master chain code from seed',
    m.masterChainCode,
    '873dff81c02f525623fd1fe5167eac3a55a049de3d314bb42ee227ffed37d508'
  );

  const parsed = w.sphereWalletFromMnemonic(VALID_12);
  check('phrase import uses Sphere descriptor path', parsed.descriptorPath, "44'/0'/0'");
  check('phrase import has no anchor pubkey', parsed.expectedPublicKey, null);
  check('phrase import produces a 64-hex chain code', /^[0-9a-f]{64}$/.test(parsed.masterChainCode), true);
  await checkThrows(
    'bad phrase is rejected',
    () => w.sphereWalletFromMnemonic('not a real phrase at all'),
    'Invalid recovery phrase'
  );
}

console.log('\n=== End-to-end: phrase -> alpha1 address on Sphere path ===');
{
  const w = loadFromIndex([...DERIVATION_FNS, ...BIP39_FNS], [
    'CHARSET',
    'BIP39_WORDLIST',
    'SPHERE_DESCRIPTOR_PATH',
  ]);
  const p = w.sphereWalletFromMnemonic(VALID_12);
  const a = w.deriveAddressAtIndex(p.masterPrivateKey, p.masterChainCode, 0, true, false, p.descriptorPath);
  check('derived path is the Sphere path', a.path, "m/44'/0'/0'/0/0");
  check('address is bech32 alpha1', /^alpha1[02-9ac-hj-np-z]{38,}$/.test(a.address), true);
}

console.log('\n=== Sphere JSON export ===');
{
  const w = loadFromIndex([...DERIVATION_FNS, ...BIP39_FNS, 'parseSphereWalletJSON'], [
    'CHARSET',
    'BIP39_WORDLIST',
    'SPHERE_DESCRIPTOR_PATH',
  ]);

  const MASTER = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
  const CHAIN = '873dff81c02f525623fd1fe5167eac3a55a049de3d314bb42ee227ffed37d508';
  const PUBKEY = w.deriveAddressAtIndex(MASTER, CHAIN, 0, true, false, "44'/0'/0'").publicKey;

  const plain = {
    version: '1.0',
    type: 'sphere-wallet',
    wallet: {
      masterPrivateKey: MASTER,
      chainCode: CHAIN,
      descriptorPath: "44'/0'/0'",
      isBIP32: true,
      addresses: [{ address: PUBKEY, publicKey: PUBKEY, path: "m/44'/0'/0'/0/0", index: 0 }],
    },
    encrypted: false,
    derivationMode: 'bip32',
  };

  const p = await w.parseSphereWalletJSON(JSON.stringify(plain));
  check('reads master key', p.masterPrivateKey, MASTER);
  check('reads chain code', p.masterChainCode, CHAIN);
  check('reads descriptor path', p.descriptorPath, "44'/0'/0'");
  check('reads anchor pubkey', p.expectedPublicKey, PUBKEY);

  // Missing descriptorPath falls back to Sphere's path, not the 84'/1'/0' wallet default.
  const noPath = JSON.parse(JSON.stringify(plain));
  delete noPath.wallet.descriptorPath;
  check(
    'missing descriptorPath falls back to Sphere path',
    (await w.parseSphereWalletJSON(JSON.stringify(noPath))).descriptorPath,
    "44'/0'/0'"
  );

  // Encrypted export: Sphere uses CryptoJS.AES.encrypt(value, password) directly.
  const enc = JSON.parse(JSON.stringify(plain));
  enc.encrypted = true;
  enc.wallet.masterPrivateKey = CryptoJS.AES.encrypt(MASTER, 'SphereTest123').toString();
  check(
    'decrypts with the right password',
    (await w.parseSphereWalletJSON(JSON.stringify(enc), 'SphereTest123')).masterPrivateKey,
    MASTER
  );
  await checkThrows(
    'encrypted without password is rejected',
    () => w.parseSphereWalletJSON(JSON.stringify(enc)),
    'encrypted'
  );
  await checkThrows('wrong password is rejected', () => w.parseSphereWalletJSON(JSON.stringify(enc), 'wrong'), 'password');

  await checkThrows('non-JSON is rejected', () => w.parseSphereWalletJSON('not json at all'), 'valid JSON');
  await checkThrows('foreign JSON is rejected', () => w.parseSphereWalletJSON('{"type":"something-else"}'), 'Sphere wallet');
  await checkThrows(
    'missing chain code is rejected',
    async () => {
      const bad = JSON.parse(JSON.stringify(plain));
      delete bad.wallet.chainCode;
      return w.parseSphereWalletJSON(JSON.stringify(bad));
    },
    'chain code'
  );
}

console.log('\n=== Wallet object: anchor check + descriptorPath persistence ===');
{
  const w = loadFromIndex(
    [...DERIVATION_FNS, ...BIP39_FNS, 'parseSphereWalletJSON', 'buildSphereImportedWallet'],
    ['CHARSET', 'BIP39_WORDLIST', 'SPHERE_DESCRIPTOR_PATH']
  );

  const MASTER = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
  const CHAIN = '873dff81c02f525623fd1fe5167eac3a55a049de3d314bb42ee227ffed37d508';
  const good = w.deriveAddressAtIndex(MASTER, CHAIN, 0, true, false, "44'/0'/0'");

  const built = w.buildSphereImportedWallet({
    masterPrivateKey: MASTER,
    masterChainCode: CHAIN,
    descriptorPath: "44'/0'/0'",
    expectedPublicKey: good.publicKey,
  });
  check('descriptorPath is persisted on the wallet', built.descriptorPath, "44'/0'/0'");
  check('marked as an imported BIP32 wallet', built.isImportedAlphaWallet, true);
  check('comes with exactly its active address', built.addresses.length, 1);
  check('active address is the anchored one', built.addresses[0].address, good.address);
  check('active address records its full path', built.addresses[0].path, "m/44'/0'/0'/0/0");
  check('signing key is the active address key', built.childPrivateKey, good.privateKey);
  check('never marked encrypted at rest', built.isEncrypted, false);

  await checkThrows(
    'mismatched anchor pubkey refuses the import',
    () =>
      w.buildSphereImportedWallet({
        masterPrivateKey: MASTER,
        masterChainCode: CHAIN,
        descriptorPath: "84'/1'/0'", // wrong branch for this export
        expectedPublicKey: good.publicKey,
      }),
    'does not match'
  );

  // No anchor (phrase import) must still work.
  const noAnchor = w.buildSphereImportedWallet({
    masterPrivateKey: MASTER,
    masterChainCode: CHAIN,
    descriptorPath: "44'/0'/0'",
    expectedPublicKey: null,
  });
  check('phrase import without anchor succeeds', noAnchor.descriptorPath, "44'/0'/0'");

  // The persistence bug this guards against: address #1 and address #2 on the same branch.
  const a0 = w.deriveAddressAtIndex(built.masterPrivateKey, built.masterChainCode, 0, true, false, built.descriptorPath);
  const a1 = w.deriveAddressAtIndex(built.masterPrivateKey, built.masterChainCode, 1, true, false, built.descriptorPath);
  check('address 0 path', a0.path, "m/44'/0'/0'/0/0");
  check('address 1 stays on the same branch', a1.path, "m/44'/0'/0'/0/1");
}

console.log('\n=== Address scan keeps the wallet on its own branch ===');
{
  // performWalletScan() rebuilds extractedWalletData when given a master key.
  // The merge must not drop descriptorPath, or the scan walks a different branch
  // than the address the wallet was imported at.
  const w = loadFromIndex(['mergeScanWalletData']);
  const merged = w.mergeScanWalletData(
    { masterKey: 'old', masterChainCode: 'old', isAlphaWallet: true, descriptorPath: "44'/0'/0'" },
    'aa'.repeat(32),
    'bb'.repeat(32),
    true
  );
  check('scan keeps descriptorPath', merged.descriptorPath, "44'/0'/0'");
  check('scan takes the new master key', merged.masterKey, 'aa'.repeat(32));
  check(
    'no previous data means no descriptorPath',
    w.mergeScanWalletData(null, 'aa'.repeat(32), 'bb'.repeat(32), true).descriptorPath,
    null
  );

  // selectWalletForImport() builds the wallet object after the user picks a scanned
  // address. It touches DOM and module globals, so they get stubbed here.
  const src = [
    extractConst(INDEX, 'CHARSET'),
    ...DERIVATION_FNS.map((n) => extractFunction(INDEX, n)),
    extractFunction(INDEX, 'selectWalletForImport'),
    'return { selectWalletForImport, deriveAddressAtIndex, getWallet: () => wallet };',
  ].join('\n\n');
  // eslint-disable-next-line no-new-func
  const sandbox = new Function(
    'CryptoJS',
    'elliptic',
    'console',
    'wallet',
    'extractedWalletData',
    'window',
    'updateButtonStates',
    'addAddressToUI',
    'saveWalletData',
    'closeRestoreModal',
    'showInAppNotification',
    'clearClassificationQueue',
    'electrumConnected',
    'refreshBalance',
    'updateScannedWalletsDisplay',
    src
  )(
    CryptoJS,
    elliptic,
    { log() {}, error() {} },
    {},
    { masterKey: 'aa'.repeat(32), masterChainCode: 'bb'.repeat(32), isAlphaWallet: true, descriptorPath: "44'/0'/0'" },
    {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    false,
    () => {},
    () => {}
  );
  const real3 = sandbox.deriveAddressAtIndex('aa'.repeat(32), 'bb'.repeat(32), 3, true, false, "44'/0'/0'");
  // A listed entry whose stored private key is wrong (e.g. a tampered scan cache).
  sandbox.selectWalletForImport({ ...real3, privateKey: 'cc'.repeat(32) });
  const picked = sandbox.getWallet();
  check('picking a scanned address persists descriptorPath', picked.descriptorPath, "44'/0'/0'");
  check('picking a scanned address keeps the chain code', picked.masterChainCode, 'bb'.repeat(32));
  check('picking a scanned address keeps the index', picked.addresses[0].index, 3);
  check('picking ignores the listed private key and re-derives it', picked.childPrivateKey, real3.privateKey);
  sandbox.selectWalletForImport({ ...real3, index: 3, address: 'alpha1qexample' });
  check('an entry whose address the key does not derive is refused', sandbox.getWallet().addresses[0].address, real3.address);
}

console.log('\n=== Text backup round-trip keeps the branch ===');
{
  const w = loadFromIndex(
    [
      ...DERIVATION_FNS,
      ...BIP39_FNS,
      'descriptorPathLine',
      'parseDescriptorPathFromText',
      'parseFirstAddressFromText',
      'resolveDescriptorPathFromBackup',
    ],
    ['CHARSET', 'BIP39_WORDLIST', 'SPHERE_DESCRIPTOR_PATH']
  );

  const MASTER = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
  const CHAIN = '873dff81c02f525623fd1fe5167eac3a55a049de3d314bb42ee227ffed37d508';
  const onSphere = w.deriveAddressAtIndex(MASTER, CHAIN, 0, true, false, "44'/0'/0'").address;
  const onLegacy = w.deriveAddressAtIndex(MASTER, CHAIN, 0, true, false, "84'/1'/0'").address;

  // What this app writes now must read back as the same path.
  check(
    'written line reads back',
    w.parseDescriptorPathFromText('WALLET TYPE: BIP32' + w.descriptorPathLine("44'/0'/0'") + '\n\nYOUR ADDRESSES:'),
    "44'/0'/0'"
  );
  check('no path means no line', w.descriptorPathLine(null), '');
  check('absent line reads as null', w.parseDescriptorPathFromText('UNICITY WALLET DETAILS\nnothing here'), null);

  // Sphere's own exportToTxt writes the same label.
  check(
    "Sphere's text export is understood",
    w.parseDescriptorPathFromText("MASTER CHAIN CODE ...\n\nDESCRIPTOR PATH: 84'/1'/0'\n\nWALLET TYPE: BIP32"),
    "84'/1'/0'"
  );
  check('a leading m/ is stripped', w.parseDescriptorPathFromText("DESCRIPTOR PATH: m/44'/0'/0'"), "44'/0'/0'");

  check('address line without a path suffix', w.parseFirstAddressFromText('YOUR ADDRESSES:\nAddress 1: ' + onSphere), onSphere);
  check(
    'address line with a path suffix',
    w.parseFirstAddressFromText("YOUR ADDRESSES:\nAddress 1: " + onSphere + " (Path: m/44'/0'/0'/0/0)"),
    onSphere
  );

  // Backups already saved in the wild have no DESCRIPTOR PATH line, but they do record the
  // address. Matching against it recovers the branch exactly.
  const legacyBackup = (addr) =>
    'UNICITY WALLET DETAILS\n===========================\n\n' +
    'MASTER PRIVATE KEY (keep secret!):\n' + MASTER + '\n\n' +
    'MASTER CHAIN CODE (for BIP32 HD wallet compatibility):\n' + CHAIN + '\n\n' +
    'WALLET TYPE: BIP32 hierarchical deterministic wallet\n\n' +
    'YOUR ADDRESSES:\nAddress 1: ' + addr + '\n';

  check(
    'old backup on the Sphere branch is recovered',
    w.resolveDescriptorPathFromBackup(legacyBackup(onSphere), MASTER, CHAIN),
    "44'/0'/0'"
  );
  check(
    'old backup on the legacy branch is recovered',
    w.resolveDescriptorPathFromBackup(legacyBackup(onLegacy), MASTER, CHAIN),
    "84'/1'/0'"
  );
  check(
    'an explicit line beats address matching',
    w.resolveDescriptorPathFromBackup(
      legacyBackup(onLegacy) + "\nDESCRIPTOR PATH: 44'/0'/0'\n",
      MASTER,
      CHAIN
    ),
    "44'/0'/0'"
  );
  check(
    'nothing to go on stays null',
    w.resolveDescriptorPathFromBackup('UNICITY WALLET DETAILS\nno addresses here', MASTER, CHAIN),
    null
  );
  check(
    'an unknown address stays null rather than guessing',
    w.resolveDescriptorPathFromBackup(legacyBackup('alpha1qnotarealaddressatall'), MASTER, CHAIN),
    null
  );
}

console.log('\n=== Old non-BIP32 (WIF/HMAC) backups are unaffected ===');
{
  const w = loadFromIndex(
    [
      ...DERIVATION_FNS,
      ...BIP39_FNS,
      'descriptorPathLine',
      'parseDescriptorPathFromText',
      'parseFirstAddressFromText',
      'resolveDescriptorPathFromBackup',
      'mergeScanWalletData',
    ],
    ['CHARSET', 'BIP39_WORDLIST', 'SPHERE_DESCRIPTOR_PATH']
  );

  // A wallet created by this app has no chain code: derivation is HMAC-SHA512(masterKey, path).
  const wifAddr0 = w.deriveAddressAtIndex(SDK_WIF_WALLET.masterKey, null, 0, true, false, null);
  check('WIF address 0 still matches the SDK vector', wifAddr0.address, SDK_WIF_WALLET.expected[0]);
  check('WIF path is unchanged', wifAddr0.path, "m/44'/0'/0'");

  // Exactly what saveWallet() writes for a standard wallet - the branch that was not touched.
  const wifBackup =
    'UNICITY WALLET DETAILS\n===========================\n\n' +
    'MASTER PRIVATE KEY (keep secret!):\n' + SDK_WIF_WALLET.masterKey + '\n\n' +
    'MASTER PRIVATE KEY IN WIF FORMAT (for importprivkey command):\nL1exampleWifKey\n\n' +
    'WALLET TYPE: Standard wallet (HMAC-based)\n\n' +
    'ENCRYPTION STATUS: Not encrypted\n\n' +
    "YOUR ADDRESSES:\nAddress 1: " + SDK_WIF_WALLET.expected[0] + " (Path: m/44'/0'/0')\n";

  check('a standard backup carries no descriptor path', w.parseDescriptorPathFromText(wifBackup), null);
  check(
    'no chain code means no path is invented',
    w.resolveDescriptorPathFromBackup(wifBackup, SDK_WIF_WALLET.masterKey, null),
    null
  );
  check('a standard wallet writes no path line', w.descriptorPathLine(undefined), '');

  // With no chain code the wallet stays on the HMAC branch whatever the path says.
  const forced = w.deriveAddressAtIndex(SDK_WIF_WALLET.masterKey, null, 0, true, false, "44'/0'/0'");
  check('a path cannot drag a chain-code-less wallet onto BIP32', forced.address, SDK_WIF_WALLET.expected[0]);

  // Scanning a standard wallet must not acquire a path either.
  const merged = w.mergeScanWalletData(null, SDK_WIF_WALLET.masterKey, null, false);
  check('scan of a standard wallet has no path', merged.descriptorPath, null);
  check('scan of a standard wallet stays non-BIP32', merged.isAlphaWallet, false);

  // An old BIP32 backup written before the path line still lands where it always did.
  const legacyBip32 =
    'MASTER PRIVATE KEY (keep secret!):\n' + SDK_BIP32_WALLET.masterKey + '\n\n' +
    'MASTER CHAIN CODE (for BIP32 HD wallet compatibility):\n' + SDK_BIP32_WALLET.chainCode + '\n\n' +
    'WALLET TYPE: BIP32 hierarchical deterministic wallet\n\n' +
    'YOUR ADDRESSES:\nAddress 1: ' + SDK_BIP32_WALLET.expected[0] + '\n';
  const legacyPath = w.resolveDescriptorPathFromBackup(
    legacyBip32,
    SDK_BIP32_WALLET.masterKey,
    SDK_BIP32_WALLET.chainCode
  );
  check('pre-existing BIP32 backup resolves to its own branch', legacyPath, "84'/1'/0'");
  check(
    'pre-existing BIP32 backup yields the same address as before',
    w.deriveAddressAtIndex(SDK_BIP32_WALLET.masterKey, SDK_BIP32_WALLET.chainCode, 0, true, false, legacyPath).address,
    SDK_BIP32_WALLET.expected[0]
  );
}

console.log('\n=== Text backup restores the address it was saved on, not index 0 ===');
{
  const w = loadFromIndex(
    [...DERIVATION_FNS, ...BIP39_FNS, 'descriptorPathLine', 'resolveDescriptorPathFromBackup'],
    ['CHARSET', 'BIP39_WORDLIST', 'SPHERE_DESCRIPTOR_PATH']
  );
  const MASTER = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
  const CHAIN = '873dff81c02f525623fd1fe5167eac3a55a049de3d314bb42ee227ffed37d508';
  const backupOf = (wallet, { withPath = true, withAddressPath = true } = {}) =>
    'MASTER CHAIN CODE (for BIP32 HD wallet compatibility):\n' + wallet.masterChainCode + '\n\n' +
    'WALLET TYPE: BIP32 hierarchical deterministic wallet' +
    (withAddressPath ? w.backupPathLines(wallet) : withPath ? w.descriptorPathLine(wallet.descriptorPath) : '') +
    '\n\nYOUR ADDRESSES:\n' +
    wallet.addresses.map((a, i) => 'Address ' + (i + 1) + ': ' + a.address).join('\n');
  const restore = (text) => {
    const sel = w.resolveHdSelectionFromBackup(text, MASTER, CHAIN);
    return w.buildHdWallet({
      masterPrivateKey: MASTER,
      masterChainCode: CHAIN,
      descriptorPath: sel ? sel.descriptorPath : null,
      chain: sel ? sel.chain : 0,
      index: sel ? sel.index : 0,
    });
  };

  // A wallet loaded on a scanned address: receive index 3 on the Sphere branch.
  const saved = w.buildHdWallet({ masterPrivateKey: MASTER, masterChainCode: CHAIN, descriptorPath: "44'/0'/0'", index: 3 });
  const text = backupOf(saved);
  check('backup records the active address path', /ADDRESS PATH: m\/44'\/0'\/0'\/0\/3/.test(text), true);
  const back = restore(text);
  check('restore lands on the saved address', back.addresses[0].address, saved.addresses[0].address);
  check('restore recovers the saved signing key', back.childPrivateKey, saved.childPrivateKey);
  check('restore keeps the branch', back.descriptorPath, "44'/0'/0'");
  check('selection checked against the recorded address is marked verified',
    w.resolveHdSelectionFromBackup(text, MASTER, CHAIN).verified, true);
  check('selection found by search is marked verified',
    w.resolveHdSelectionFromBackup(backupOf(saved, { withAddressPath: false }), MASTER, CHAIN).verified, true);
  check('ADDRESS PATH with no recorded address is NOT verified',
    w.resolveHdSelectionFromBackup(text.replace(/YOUR ADDRESSES:[\s\S]*$/, ''), MASTER, CHAIN).verified, false);

  // Change-chain address survives too.
  const change = w.buildHdWallet({ masterPrivateKey: MASTER, masterChainCode: CHAIN, descriptorPath: "44'/0'/0'", chain: 1, index: 2 });
  const changeBack = restore(backupOf(change));
  check('change address restores on chain 1', changeBack.addresses[0].path, "m/44'/0'/0'/1/2");
  check('change signing key restores', changeBack.childPrivateKey, change.childPrivateKey);

  // Backups written before ADDRESS PATH existed: found by matching the recorded address.
  const legacyBack = restore(backupOf(saved, { withAddressPath: false }));
  check('older backup with DESCRIPTOR PATH finds index 3', legacyBack.childPrivateKey, saved.childPrivateKey);
  const oldest = restore(backupOf(saved, { withPath: false, withAddressPath: false }));
  check('oldest backup (no path lines) finds branch and index', oldest.addresses[0].path, "m/44'/0'/0'/0/3");
  check('oldest backup recovers the signing key', oldest.childPrivateKey, saved.childPrivateKey);
  const bip84 = w.buildHdWallet({ masterPrivateKey: MASTER, masterChainCode: CHAIN, descriptorPath: "84'/1'/0'", index: 5 });
  check('oldest 84\'/1\'/0\' backup finds index 5',
    restore(backupOf(bip84, { withPath: false, withAddressPath: false })).childPrivateKey, bip84.childPrivateKey);
  check('descriptor-only resolver still answers', w.resolveDescriptorPathFromBackup(text, MASTER, CHAIN), "44'/0'/0'");

  // Contradictions are refused.
  await checkThrows('ADDRESS PATH that does not derive the recorded address is refused',
    () => restore(text.replace("0'/0/3", "0'/0/4")), 'refusing to import');
  await checkThrows('DESCRIPTOR PATH and ADDRESS PATH on different branches is refused',
    () => restore(text.replace("DESCRIPTOR PATH: 44'/0'/0'", "DESCRIPTOR PATH: 84'/1'/0'")), 'refusing to import');

  // An address that matches nothing keeps the old behaviour: index 0 on the default branch.
  const stranger = text.replace(/ADDRESS PATH:[^\n]*\n?/, '').replace(/DESCRIPTOR PATH:[^\n]*/, '')
    .replace(saved.addresses[0].address, 'alpha1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq');
  const strangerSel = w.resolveHdSelectionFromBackup(stranger, MASTER, CHAIN);
  check('unmatched legacy backup is flagged, not silently index 0', strangerSel && strangerSel.unverified, true);
  check('unmatched legacy backup reports the address it could not find',
    strangerSel && strangerSel.recordedAddress, 'alpha1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq');

  // Index beyond BIP32's non-hardened range must not alias to a small index.
  const huge = text.replace("m/44'/0'/0'/0/3", "m/44'/0'/0'/0/4294967299");
  const hugeSel = w.resolveHdSelectionFromBackup(huge, MASTER, CHAIN);
  check('out-of-range ADDRESS PATH is ignored, not aliased', hugeSel.index, 3);
  await checkThrows('out-of-range index is refused by the builder',
    () => w.buildHdWallet({ masterPrivateKey: MASTER, masterChainCode: CHAIN, descriptorPath: "44'/0'/0'", index: 2 ** 31 }),
    'out of range');

  // An empty value must not swallow the following line.
  check('empty DESCRIPTOR PATH value reads as absent',
    w.resolveHdSelectionFromBackup(text.replace("DESCRIPTOR PATH: 44'/0'/0'", 'DESCRIPTOR PATH:'), MASTER, CHAIN).index, 3);
  check('CRLF backup restores the same address',
    w.resolveHdSelectionFromBackup(text.replace(/\n/g, '\r\n'), MASTER, CHAIN).index, 3);

  // Both lines come from the active address, so a stored descriptorPath in another
  // spelling cannot produce a backup this wallet then refuses.
  const odd = { ...saved, descriptorPath: "m/44'/0'/0'" };
  check('backup written from an odd descriptorPath spelling still restores',
    restore(backupOf(odd)).childPrivateKey, saved.childPrivateKey);

  // Standard (HMAC) wallets never get the line.
  check('no path lines for wallets without a chain code',
    w.backupPathLines({ masterChainCode: null, addresses: [{ path: "m/44'/0'/0'" }] }), '');
}

console.log('\n=== Save-time check: the backup restores the same address AND signing key ===');
{
  const w = loadFromIndex(
    [...DERIVATION_FNS, ...BIP39_FNS, 'descriptorPathLine', 'checkBackupRestoresWallet'],
    ['CHARSET', 'BIP39_WORDLIST', 'SPHERE_DESCRIPTOR_PATH']
  );
  const MASTER = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
  const CHAIN = '873dff81c02f525623fd1fe5167eac3a55a049de3d314bb42ee227ffed37d508';
  const wallet = w.buildHdWallet({ masterPrivateKey: MASTER, masterChainCode: CHAIN, descriptorPath: "44'/0'/0'", index: 3 });
  const text = 'MASTER CHAIN CODE (for BIP32 HD wallet compatibility):\r\n' + CHAIN + '\r\n\r\n' +
    'WALLET TYPE: BIP32 hierarchical deterministic wallet' + w.backupPathLines(wallet) +
    '\n\nYOUR ADDRESSES:\nAddress 1: ' + wallet.addresses[0].address;
  check('a correct backup passes', w.checkBackupRestoresWallet(text, MASTER, wallet), null);
  check('a backup missing its path lines still passes (found by search)',
    w.checkBackupRestoresWallet(text.replace(/\n\nDESCRIPTOR PATH:[^\n]*\nADDRESS PATH:[^\n]*/, ''), MASTER, wallet), null);
  const other = w.buildHdWallet({ masterPrivateKey: MASTER, masterChainCode: CHAIN, descriptorPath: "44'/0'/0'", index: 4 });
  check('a backup that would restore another address is caught',
    /instead of/.test(w.checkBackupRestoresWallet(text, MASTER, other) || ''), true);
  check('a wrong signing key is caught',
    /different signing key/.test(
      w.checkBackupRestoresWallet(text, MASTER, { ...wallet, childPrivateKey: other.childPrivateKey }) || ''), true);
  check('a wrong chain code in the file is caught',
    /chain code/.test(w.checkBackupRestoresWallet(text.replace(CHAIN, CHAIN.replace(/^8/, '9')), MASTER, wallet) || ''), true);
  check('standard (HMAC) wallets are left to the existing checks',
    w.checkBackupRestoresWallet('anything', MASTER, { masterChainCode: null, isImportedAlphaWallet: false }), null);
}

console.log('\n=== Key/address invariant: signing key must match the address and the master key ===');
{
  const w = loadFromIndex(
    [...DERIVATION_FNS, ...BIP39_FNS, 'checkWalletKeyIntegrity'],
    ['CHARSET', 'BIP39_WORDLIST', 'SPHERE_DESCRIPTOR_PATH']
  );
  const MASTER = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
  const CHAIN = '873dff81c02f525623fd1fe5167eac3a55a049de3d314bb42ee227ffed37d508';
  const good = w.buildHdWallet({ masterPrivateKey: MASTER, masterChainCode: CHAIN, descriptorPath: "44'/0'/0'", index: 3 });
  const other = w.buildHdWallet({ masterPrivateKey: MASTER, masterChainCode: CHAIN, descriptorPath: "44'/0'/0'", index: 1 });
  check('consistent BIP32 wallet passes', w.checkWalletKeyIntegrity(good), null);
  check('signing key of another address is caught',
    /does not belong to address/.test(w.checkWalletKeyIntegrity({ ...good, childPrivateKey: other.childPrivateKey }) || ''), true);
  check('wrong stored public key is caught',
    /public key/.test(w.checkWalletKeyIntegrity({
      ...good, addresses: [{ ...good.addresses[0], publicKey: other.addresses[0].publicKey }],
    }) || ''), true);
  // Key and address agree with each other but are not what the master key derives at that path.
  const swapped = { ...good, childPrivateKey: other.childPrivateKey, addresses: [{ ...other.addresses[0], path: good.addresses[0].path }] };
  check('key+address not derived by the master key at the stored path is caught',
    /master key does not derive/.test(w.checkWalletKeyIntegrity(swapped) || ''), true);
  check('BIP32 wallet with a different master key is caught',
    /master key does not derive/.test(w.checkWalletKeyIntegrity({ ...good, masterPrivateKey: MASTER.replace(/^e/, 'f') }) || ''), true);
  check('addresses with no signing key is a failure',
    /no signing key/.test(w.checkWalletKeyIntegrity({ ...good, childPrivateKey: null }) || ''), true);
  check('upper-case signing key is accepted', w.checkWalletKeyIntegrity({ ...good, childPrivateKey: good.childPrivateKey.toUpperCase() }), null);
  check('wallet with no address yet has nothing to check',
    w.checkWalletKeyIntegrity({ masterPrivateKey: MASTER, addresses: [], childPrivateKey: null }), null);

  // App-created (HMAC) wallets.
  const h0 = w.deriveAddressAtIndex(SDK_WIF_WALLET.masterKey, null, 0, false, false, null);
  const h1 = w.deriveAddressAtIndex(SDK_WIF_WALLET.masterKey, null, 1, false, false, null);
  const hmac = {
    masterPrivateKey: SDK_WIF_WALLET.masterKey, isImportedAlphaWallet: false, masterChainCode: null,
    childPrivateKey: h0.privateKey, addresses: [{ index: 0, address: h0.address, publicKey: h0.publicKey, path: h0.path }],
  };
  check('consistent HMAC wallet passes', w.checkWalletKeyIntegrity(hmac), null);
  check('HMAC wallet with another index key is caught',
    /does not belong to address/.test(w.checkWalletKeyIntegrity({ ...hmac, childPrivateKey: h1.privateKey }) || ''), true);
}

console.log('\n=== Sphere export: v2 authenticated encryption + anchors ===');
{
  const w = loadFromIndex([...DERIVATION_FNS, ...BIP39_FNS, 'parseSphereWalletJSON', 'buildSphereImportedWallet'], [
    'CHARSET',
    'BIP39_WORDLIST',
    'SPHERE_DESCRIPTOR_PATH',
  ]);
  // Mirror of sphere-sdk core/encryption.ts encrypt() + encryptSimple() ("v2:" envelope).
  const encryptV2 = (plaintext, password, iterations = 1000) => {
    const salt = CryptoJS.lib.WordArray.random(16);
    const iv = CryptoJS.lib.WordArray.random(16);
    const material = CryptoJS.PBKDF2(password, salt, { keySize: 16, iterations, hasher: CryptoJS.algo.SHA256 });
    const encKey = CryptoJS.lib.WordArray.create(material.words.slice(0, 8), 32);
    const macKey = CryptoJS.lib.WordArray.create(material.words.slice(8, 16), 32);
    const enc = CryptoJS.AES.encrypt(plaintext, encKey, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
    const mac = CryptoJS.HmacSHA256(iv.clone().concat(enc.ciphertext), macKey).toString(CryptoJS.enc.Hex);
    const env = {
      ciphertext: enc.ciphertext.toString(CryptoJS.enc.Base64),
      iv: iv.toString(CryptoJS.enc.Hex),
      salt: salt.toString(CryptoJS.enc.Hex),
      algorithm: 'aes-256-cbc-hmac-sha256',
      kdf: 'pbkdf2',
      iterations,
      mac,
    };
    return 'v2:' + Buffer.from(JSON.stringify(env)).toString('base64');
  };
  const MASTER = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
  const CHAIN = '873dff81c02f525623fd1fe5167eac3a55a049de3d314bb42ee227ffed37d508';

  const v2 = encryptV2(MASTER, 'pw');
  check('v2 value decrypts with the right password', await w.decryptSphereValue(v2, 'pw'), MASTER);
  check('v2 value with a wrong password reads as empty', await w.decryptSphereValue(v2, 'nope'), '');
  const env = JSON.parse(Buffer.from(v2.slice(3), 'base64').toString());
  const tampered = 'v2:' + Buffer.from(JSON.stringify({ ...env, mac: 'f'.repeat(64) })).toString('base64');
  check('v2 value with a bad MAC reads as empty', await w.decryptSphereValue(tampered, 'pw'), '');
  const unauth = 'v2:' + Buffer.from(JSON.stringify({ ...env, algorithm: 'aes-256-cbc' })).toString('base64');
  check('v2 envelope claiming an unauthenticated algorithm is refused', await w.decryptSphereValue(unauth, 'pw'), '');
  const huge = 'v2:' + Buffer.from(JSON.stringify({ ...env, iterations: 2 ** 31 })).toString('base64');
  check('v2 envelope with absurd iterations is refused', await w.decryptSphereValue(huge, 'pw'), '');
  check('legacy CryptoJS value still decrypts',
    await w.decryptSphereValue(CryptoJS.AES.encrypt(MASTER, 'pw').toString(), 'pw'), MASTER);

  const good = w.deriveAddressAtIndex(MASTER, CHAIN, 0, true, false, "44'/0'/0'");
  const exportOf = (overrides) => JSON.stringify({
    version: '1.0',
    type: 'sphere-wallet',
    wallet: {
      masterPrivateKey: MASTER,
      chainCode: CHAIN,
      descriptorPath: "44'/0'/0'",
      addresses: [{ address: good.address, publicKey: good.publicKey, path: "m/44'/0'/0'/0/0", index: 0 }],
      ...overrides,
    },
    encrypted: false,
  });

  const enc = JSON.parse(exportOf({}));
  enc.encrypted = true;
  enc.wallet.masterPrivateKey = encryptV2(MASTER, 'pw');
  const fromV2 = w.buildSphereImportedWallet(await w.parseSphereWalletJSON(JSON.stringify(enc), 'pw'));
  check('encrypted v2 export imports to the right signing key', fromV2.childPrivateKey, good.privateKey);
  await checkThrows('encrypted v2 export with a wrong password is refused',
    () => w.parseSphereWalletJSON(JSON.stringify(enc), 'nope'), 'wrong password');

  const addressOnly = await w.parseSphereWalletJSON(
    exportOf({ addresses: [{ address: good.address, path: "m/44'/0'/0'/0/0" }] }), '');
  check('anchor works with an address and no public key',
    w.buildSphereImportedWallet(addressOnly).addresses[0].address, good.address);
  await checkThrows('anchor on a wrong address is refused', async () => w.buildSphereImportedWallet(
    await w.parseSphereWalletJSON(exportOf({ addresses: [{ address: 'alpha1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' }] }), '')),
    'refusing to import');

  const one = w.deriveAddressAtIndex(MASTER, CHAIN, 1, true, false, "44'/0'/0'");
  const atOne = w.buildSphereImportedWallet(await w.parseSphereWalletJSON(
    exportOf({ addresses: [{ address: one.address, publicKey: one.publicKey, path: "m/44'/0'/0'/0/1", index: 1 }] }), ''));
  check('anchor follows the path the export records', atOne.childPrivateKey, one.privateKey);

  const phraseWallet = w.sphereWalletFromMnemonic(VALID_12);
  const withPhrase = JSON.parse(exportOf({}));
  withPhrase.mnemonic = VALID_12;
  withPhrase.wallet.addresses = [];
  await checkThrows('phrase that does not match the export master key is refused',
    () => w.parseSphereWalletJSON(JSON.stringify(withPhrase), ''), 'does not match');
  withPhrase.wallet.masterPrivateKey = phraseWallet.masterPrivateKey;
  withPhrase.wallet.chainCode = undefined;
  check('chain code is taken from the phrase',
    (await w.parseSphereWalletJSON(JSON.stringify(withPhrase), '')).masterChainCode, phraseWallet.masterChainCode);
}

console.log('\n=== generateNewAddress: next index after a scanned pick ===');
{
  const support = [...DERIVATION_FNS, 'generateNewAddress'].map((n) => extractFunction(INDEX, n));
  const src = [
    extractConst(INDEX, 'CHARSET'),
    'let wallet = {}; let electrumConnected = false;',
    'function addAddressToUI() {} function saveWalletData() {} function showInAppNotification() {}',
    'function alert(m) { throw new Error(m); }',
    ...support,
    'return { deriveAddressAtIndex, generateNewAddress, set wallet(v) { wallet = v; }, get wallet() { return wallet; } };',
  ].join('\n\n');
  // eslint-disable-next-line no-new-func
  const w = new Function('CryptoJS', 'elliptic', 'console', src)(CryptoJS, elliptic, { log() {} });
  const MASTER = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
  const CHAIN = '873dff81c02f525623fd1fe5167eac3a55a049de3d314bb42ee227ffed37d508';
  const at = (i) => w.deriveAddressAtIndex(MASTER, CHAIN, i, true, false, "44'/0'/0'");

  w.wallet = {
    masterPrivateKey: MASTER, masterChainCode: CHAIN, descriptorPath: "44'/0'/0'", isImportedAlphaWallet: true,
    childPrivateKey: at(3).privateKey, addresses: [{ index: 3, address: at(3).address, path: "m/44'/0'/0'/0/3" }],
  };
  w.generateNewAddress();
  check('after picking index 3 the next address is index 4', w.wallet.addresses[1].path, "m/44'/0'/0'/0/4");
  check('index 4 address is correct', w.wallet.addresses[1].address, at(4).address);
  check('signing key stays on the picked address', w.wallet.childPrivateKey, at(3).privateKey);

  w.wallet = {
    masterPrivateKey: MASTER, masterChainCode: CHAIN, descriptorPath: "44'/0'/0'", isImportedAlphaWallet: true,
    childPrivateKey: null, addresses: [],
  };
  w.generateNewAddress();
  w.generateNewAddress();
  check('fresh wallet starts at index 0', w.wallet.addresses[0].path, "m/44'/0'/0'/0/0");
  check('fresh wallet signing key is index 0', w.wallet.childPrivateKey, at(0).privateKey);
  check('second address is index 1', w.wallet.addresses[1].address, at(1).address);
}

console.log('\n=== Scope: top-level functions cannot reach DOMContentLoaded helpers ===');
{
  // index.html has two scopes in one <script>: functions indented 8 spaces are top level,
  // functions indented 12 spaces live inside the DOMContentLoaded callback. A top-level
  // function calling an inner one directly throws ReferenceError only when the user clicks,
  // which looks like "the button does nothing". Crossing the boundary needs window.<name>,
  // the pattern window.hexToWIF already uses.
  const inner = [...INDEX.matchAll(/^ {12}function ([a-zA-Z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
  const outer = [...INDEX.matchAll(/^ {8}function ([a-zA-Z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
  check('inner scope was found', inner.length > 100, true);
  check('outer scope was found', outer.length > 0, true);

  const leaks = [];
  for (const name of outer) {
    const src = extractFunction(INDEX, name);
    for (const helper of inner) {
      if (new RegExp('(^|[^.\\w$])' + helper + '\\s*\\(').test(src)) {
        leaks.push(name + ' -> ' + helper);
      }
    }
  }
  check('no top-level function calls an inner helper directly', leaks.join('; ') || 'none', 'none');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
