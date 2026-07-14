import * as Cardano from '../../src/utils/cardano';

describe('cardano serialization adapter', () => {
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
});
