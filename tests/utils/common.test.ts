import * as CardanoWasm from '../../src/utils/cardano';
import * as utils from '../../src/utils/common';
import * as fixtures from './fixtures/common';
import { changeAddress } from '../fixtures/constants';

describe('common utils', () => {
  test('multiAssetToArray', () => {
    const multiAsset = utils.buildMultiAsset([
      {
        quantity: '1000',
        unit: '02477d7c23b4c2834b0be8ca8578dde47af0cc82a964688f6fc95a7a47524943',
      },
    ]);
    const res = utils.multiAssetToArray(multiAsset);
    expect(res).toMatchObject([
      {
        quantity: '1000',
        unit: '02477d7c23b4c2834b0be8ca8578dde47af0cc82a964688f6fc95a7a47524943',
      },
    ]);
  });

  test('splitChangeOutput limits assets rather than policy ids', () => {
    const policyId = '02477d7c23b4c2834b0be8ca8578dde47af0cc82a964688f6fc95a7a';
    const output = utils.buildTxOutput(
      {
        address: changeAddress,
        amount: '5000000',
        assets: [
          { quantity: '10', unit: `${policyId}01` },
          { quantity: '20', unit: `${policyId}02` },
        ],
        setMax: false,
      },
      changeAddress,
    );
    const txBuilder = utils.getTxBuilder();
    const original = utils.getOutputCost(
      txBuilder,
      {
        address: changeAddress,
        amount: '5000000',
        assets: utils.multiAssetToArray(output.amount().multi_asset()),
        setMax: false,
      },
      changeAddress,
    );

    const split = utils.splitChangeOutput(
      txBuilder,
      original,
      changeAddress,
      1,
    );

    expect(split).toHaveLength(2);
    expect(
      split.flatMap(item =>
        utils.multiAssetToArray(item.output.amount().multi_asset()),
      ),
    ).toEqual([
      { quantity: '10', unit: `${policyId}01` },
      { quantity: '20', unit: `${policyId}02` },
    ]);
    const originalCost =
      original.output.amount().coin() + original.outputFee.to_bigint();
    const splitCost = split.reduce(
      (sum, item) =>
        sum + item.output.amount().coin() + item.outputFee.to_bigint(),
      BigInt(0),
    );
    expect(splitCost).toBe(originalCost);
  });

  fixtures.filterUtxos.forEach(f => {
    test(f.description, () => {
      expect(utils.filterUtxos(f.utxos, f.asset)).toMatchObject(f.result);
    });
  });

  fixtures.buildTxOutput.forEach(f => {
    test(f.description, () => {
      const output = utils.buildTxOutput(f.output, f.dummyAddress);
      const assets = utils.multiAssetToArray(output.amount().multi_asset());

      let address;
      if (CardanoWasm.ByronAddress.is_valid(f.result.address)) {
        // expecting byron address
        address = CardanoWasm.ByronAddress.from_address(
          output.address(),
        )?.to_base58();
      } else {
        address = output.address().to_bech32(); // by default expect shelley
      }
      expect(output.amount().coin().toString()).toBe(f.result.amount);
      expect(address).toBe(f.result.address);
      expect(assets).toStrictEqual(f.result.assets);
    });
  });

  fixtures.orderInputs.forEach(f => {
    test(f.description, () => {
      const inputs = utils.orderInputs(
        f.inputsToOrder,
        CardanoWasm.TransactionBody.from_cbor_bytes(
          Buffer.from(f.txBodyHex, 'hex'),
        ),
      );
      expect(inputs).toStrictEqual(f.result);
    });
  });
});
