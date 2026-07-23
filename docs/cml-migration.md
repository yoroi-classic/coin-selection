# CML migration

Issues: https://github.com/yoroi-classic/coin-selection/issues/6 and
https://github.com/yoroi-classic/coin-selection/issues/7

Runtime and test imports enter through `src/utils/cardano.ts`, which exports
`@dcspark/cardano-multiplatform-lib-nodejs@6.2.0`. The published browser build
is selected by an exact package-name mapping to
`@dcspark/cardano-multiplatform-lib-browser@6.2.0`.

The target packages exist as:

- `@dcspark/cardano-multiplatform-lib-nodejs@6.2.0`
- `@dcspark/cardano-multiplatform-lib-browser@6.2.0`

A direct import rename was not safe because CML is not API-compatible with the
former CSL surface. The migration therefore keeps those differences internal.

## Compatibility decisions

- Public exports and result field types are unchanged. In particular, amounts,
  fees, hashes, transaction bodies, and signed transactions remain strings.
- CML uses native `bigint`. An internal non-negative `BigNum` adapter preserves
  the existing exact checked arithmetic without converting protocol quantities
  through JavaScript `number`.
- Inputs, values, multi-assets, minimum ADA, certificates, withdrawals, and
  change selection use CML's native APIs. Builder calls use
  `SingleInputBuilder`, `SingleOutputBuilderResult`,
  `SingleCertificateBuilder`, and `SingleWithdrawalBuilder`.
- The adapter inserts multi-assets in canonical CBOR map order (policy bytes,
  then asset-name encoded length and bytes). CML-derived and change-output
  arrays consequently use that same ordering while retaining the same units
  and exact quantities.
- CML renamed the test-network helpers to `preprod` and `preview`; the existing
  network constants remain unchanged.
- CML does not parse legacy `drep` and `drep_script` bech32 identifiers. A small
  `bech32` boundary preserves both accepted prefixes and validates the required
  28-byte hash length.
- CML omits optional CBOR tag 258 for some parsed or constructed set encodings,
  while its builders canonicalize ordered sets with the tag. Trezor signing
  therefore normalizes every transaction-body and witness-set field defined as
  a set by the ledger CDDL. This preserves the existing signed bytes and
  transaction hash exactly, including Byron witness behavior.

The behavior fixtures cover largest-first and random-improve selection,
set-max, split change, insufficient funds, multi-assets, minimum ADA,
certificates, withdrawals, DRep transformations, input ordering, and Trezor
serialization. The manifest and lockfile contain no CSL package.
