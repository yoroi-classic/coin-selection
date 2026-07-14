import * as Cardano from '../../src/utils/cardano';

describe('cardano serialization adapter', () => {
  const shelleyAddress =
    'addr1q8u2f05rprqjhygz22m06mhy4xrnqvqqpyuzhmxqfxnwvxz8d2kd47hsre5v9urjyu8s0ryk38dxzw0t5jesncw4v90s22tk0f';

  test('exposes the numeric and builder primitives used by coin-selection', () => {
    const feeA = Cardano.BigNum.from_str('44');
    const feeB = Cardano.BigNum.from_str('155381');

    const config = Cardano.TransactionBuilderConfigBuilder.new()
      .fee_algo(Cardano.LinearFee.new(feeA, feeB))
      .pool_deposit(Cardano.BigNum.from_str('500000000'))
      .key_deposit(Cardano.BigNum.from_str('2000000'))
      .coins_per_utxo_byte(Cardano.BigNum.from_str('4310'))
      .max_value_size(5000)
      .max_tx_size(16384)
      .build();

    expect(feeA.checked_add(feeB).to_str()).toBe('155425');
    expect(config).toBeDefined();
    expect(Cardano.NetworkInfo.mainnet().network_id()).toBe(1);
  });

  test('backs every declared compatibility export at runtime', () => {
    Cardano.CARDANO_SERIALIZATION_COMPAT_EXPORTS.forEach(exportName => {
      expect(Cardano[exportName]).toBeDefined();
    });
  });

  test('preserves the legacy BigNum arithmetic surface', () => {
    const oneAda = Cardano.BigNum.from_str('1000000');
    const halfAda = Cardano.BigNum.from_str('500000');

    expect(oneAda.checked_add(halfAda).to_str()).toBe('1500000');
    expect(oneAda.checked_sub(halfAda).to_str()).toBe('500000');
    expect(halfAda.checked_mul(Cardano.BigNum.from_str('3')).to_str()).toBe(
      '1500000',
    );
    expect(halfAda.clamped_sub(oneAda).to_str()).toBe('0');
    expect(oneAda.compare(halfAda)).toBe(1);
  });

  test('preserves multi-asset value and min-ada output behavior', () => {
    const policy = Cardano.ScriptHash.from_bytes(
      Buffer.from('00'.repeat(28), 'hex'),
    );
    const assetName = Cardano.AssetName.new(Buffer.from('544f4b454e', 'hex'));
    const assets = Cardano.Assets.new();
    assets.insert(assetName, Cardano.BigNum.from_str('1234'));

    const multiAsset = Cardano.MultiAsset.new();
    multiAsset.insert(policy, assets);

    const value = Cardano.Value.new(Cardano.BigNum.from_str('2000000'));
    value.set_multiasset(multiAsset);

    const output = Cardano.TransactionOutput.new(
      Cardano.Address.from_bech32(shelleyAddress),
      value,
    );
    const minAda = Cardano.min_ada_for_output(
      output,
      Cardano.DataCost.new_coins_per_byte(Cardano.BigNum.from_str('4310')),
    );

    expect(output.amount().coin().to_str()).toBe('2000000');
    expect(output.amount().multiasset()?.len()).toBe(1);
    expect(minAda.compare(Cardano.BigNum.from_str('0'))).toBeGreaterThan(0);
  });

  test('preserves transaction input, body, hash, and witness primitives', () => {
    const input = Cardano.TransactionInput.new(
      Cardano.TransactionHash.from_bytes(Buffer.from('11'.repeat(32), 'hex')),
      2,
    );
    const address = Cardano.Address.from_bech32(shelleyAddress);
    const inputValue = Cardano.Value.new(Cardano.BigNum.from_str('5000000'));
    const output = Cardano.TransactionOutput.new(
      address,
      Cardano.Value.new(Cardano.BigNum.from_str('4800000')),
    );
    const txBuilder = Cardano.TransactionBuilder.new(
      Cardano.TransactionBuilderConfigBuilder.new()
        .fee_algo(
          Cardano.LinearFee.new(
            Cardano.BigNum.from_str('44'),
            Cardano.BigNum.from_str('155381'),
          ),
        )
        .pool_deposit(Cardano.BigNum.from_str('500000000'))
        .key_deposit(Cardano.BigNum.from_str('2000000'))
        .coins_per_utxo_byte(Cardano.BigNum.from_str('4310'))
        .max_value_size(5000)
        .max_tx_size(16384)
        .build(),
    );

    txBuilder.add_regular_input(address, input, inputValue);
    txBuilder.add_output(output);
    txBuilder.set_fee(Cardano.BigNum.from_str('200000'));

    const body = txBuilder.build();
    const parsedBody = Cardano.TransactionBody.from_bytes(body.to_bytes());
    const transaction = Cardano.Transaction.new(
      parsedBody,
      Cardano.TransactionWitnessSet.new(),
    );
    const parsedTransaction = Cardano.Transaction.from_bytes(
      transaction.to_bytes(),
    );

    expect(parsedBody.inputs().get(0).index()).toBe(2);
    expect(parsedBody.outputs().get(0).amount().coin().to_str()).toBe(
      '4800000',
    );
    expect(parsedBody.fee().to_str()).toBe('200000');
    expect(
      Cardano.FixedTransaction.new_from_body_bytes(parsedBody.to_bytes())
        .transaction_hash()
        .to_hex(),
    ).toHaveLength(64);
    expect(parsedTransaction.body().fee().to_str()).toBe('200000');
  });
});
