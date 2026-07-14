# CML migration blocker

Issue: https://github.com/yoroi-classic/coin-selection/issues/1

Runtime and test imports now enter through `src/utils/cardano.ts`, which
currently re-exports `@emurgo/cardano-serialization-lib-nodejs`. The published
browser build is still selected with the `package.json` `browser` field.

The target packages exist as:

- `@dcspark/cardano-multiplatform-lib-nodejs@6.2.0`
- `@dcspark/cardano-multiplatform-lib-browser@6.2.0`

A direct import rename is not safe because CML is not API-compatible with the
CSL surface used here.

## Blocking API differences

- Numeric values use native `bigint` in CML. CSL `BigNum` helpers used here
  (`from_str`, `to_str`, `checked_add`, `checked_sub`, `clamped_sub`,
  `checked_mul`, `compare`) do not exist as a drop-in type.
- `TransactionInput.new` takes a `bigint` index in CML, while this package
  currently passes a number.
- `Value` construction changed. CSL uses `Value.new`, `Value.new_from_assets`,
  and `set_multiasset`; CML uses `Value.from_coin`, `Value.new(coin,
  multiasset)`, `multi_asset()`, and immutable-style arithmetic.
- `MultiAsset` construction changed. CSL `Assets` and `MultiAsset.insert`
  are not the CML API; CML uses `MapAssetNameToCoin` and
  `MultiAsset.insert_assets` or `MultiAsset.set`.
- `TransactionBuilder` changed from accepting raw CSL inputs/outputs/certs to
  builder-result types. Calls such as `add_regular_input(address, input,
  amount)`, `add_output(txOutput)`, `set_certs(certs)`,
  `set_withdrawals(withdrawals)`, `fee_for_input(address, input, amount)`, and
  `fee_for_output(txOutput)` need to be rewritten around
  `SingleInputBuilder`, `SingleOutputBuilderResult`,
  `SingleCertificateBuilder`, and `SingleWithdrawalBuilder`.
- `TransactionBuilder.min_fee()` now requires a boolean script-calculation
  flag, and `TransactionBuilder.build()` now requires change-selection
  parameters and returns a `SignedTxBuilder`, not a `TransactionBody`.
- Serialization helpers were renamed. CSL `to_bytes` / `from_bytes` usages
  need to become the appropriate CML CBOR or raw-byte APIs, depending on the
  type.
- `min_ada_for_output(output, DataCost)` is not present under that name in
  CML. CML exposes `min_ada_required(output, coins_per_utxo_byte)` and output
  builder helpers such as `with_asset_and_min_required_coin`.
- Trezor signing also needs API updates: `Transaction.new` takes an
  `is_valid` flag in CML, witness sets use CML list/builder names, and Byron
  address helpers return different intermediate types.

## Safe next step

The migration should replace the centralized Cardano adapter with a CML-backed
compatibility layer rather than doing a repo-wide import rename. That adapter
should preserve the current coin-selection invariants first:

- exact selected input ordering returned from transaction bodies;
- fee and min-ADA calculations for ADA-only, multi-asset, split-change, and
  set-max outputs;
- stake registration, deregistration, delegation, vote delegation, and
  withdrawal fee/deposit behavior;
- Trezor Shelley witness serialization and Byron witness behavior.

Once the adapter is in place, the dependency check for issue #1 can be made
strict: a fresh install must not resolve any `@emurgo/cardano-serialization-lib-*`
package.
