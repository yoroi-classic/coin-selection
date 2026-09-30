import * as CardanoWasm from '../../src/utils/cardano';
import * as utils from '../../src/utils/common';
import { coinSelection } from '../../src';
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

  test.each([
    { assetCount: 51, expectedBundleSizes: [51] },
    { assetCount: 142, expectedBundleSizes: [141, 1] },
  ])(
    'splitChangeOutput respects the serialized value limit for $assetCount assets',
    ({ assetCount, expectedBundleSizes }) => {
      const policyId =
        '02477d7c23b4c2834b0be8ca8578dde47af0cc82a964688f6fc95a7a';
      const assets = Array.from({ length: assetCount }, (_, index) => ({
        quantity: '1',
        unit: `${policyId}${index.toString(16).padStart(64, '0')}`,
      }));
      const txBuilder = utils.getTxBuilder();
      const original = {
        output: CardanoWasm.TransactionOutput.new(
          CardanoWasm.Address.from_bech32(changeAddress),
          CardanoWasm.Value.new(
            BigInt(100000000),
            utils.buildMultiAsset(assets),
          ),
        ),
        outputFee: CardanoWasm.BigNum.from_bigint(BigInt(0)),
        minOutputAmount: CardanoWasm.BigNum.from_bigint(BigInt(0)),
      };

      const split = utils.splitChangeOutput(txBuilder, original, changeAddress);
      const bundleAssets = split.map(item =>
        utils.multiAssetToArray(item.output.amount().multi_asset()),
      );
      expect(bundleAssets.map(bundle => bundle.length)).toEqual(
        expectedBundleSizes,
      );
      expect(
        bundleAssets.every(
          bundle =>
            CardanoWasm.Value.new(
              BigInt(100000000),
              utils.buildMultiAsset(bundle),
            ).to_cbor_bytes().length <= 5000,
        ),
      ).toBe(true);
      expect(bundleAssets.flat()).toEqual(assets);

      const originalCost =
        original.output.amount().coin() + original.outputFee.to_bigint();
      const splitCost = split.reduce(
        (sum, item) =>
          sum + item.output.amount().coin() + item.outputFee.to_bigint(),
        BigInt(0),
      );
      expect(splitCost).toBe(originalCost);
    },
  );

  test.each([false, true])(
    'coinSelection splits oversized change values (forceLargestFirstSelection=%s)',
    forceLargestFirstSelection => {
      const policyId =
        '02477d7c23b4c2834b0be8ca8578dde47af0cc82a964688f6fc95a7a';
      const makeAssets = (start: number) =>
        Array.from({ length: 100 }, (_, index) => ({
          quantity: '1',
          unit: `${policyId}${(start + index).toString(16).padStart(64, '0')}`,
        }));
      const inputUtxos = [0, 1].map(index => ({
        address: changeAddress,
        txHash: (index + 1).toString(16).padStart(64, '0'),
        outputIndex: 0,
        amount: [
          { quantity: '40000000', unit: 'lovelace' },
          ...makeAssets(index * 100),
        ],
      }));

      const result = coinSelection(
        {
          utxos: inputUtxos,
          outputs: [{ address: changeAddress, amount: '40500000', assets: [] }],
          changeAddress,
          certificates: [],
          withdrawals: [],
          accountPubKey:
            'ec8fdf616242f430855ad7477acda53395eb30c295f5a7ef038712578877375b5a2f00353c9c5cc88c7ff18e71dc08724d90fc238213b789c0b02438e336be07',
        },
        { forceLargestFirstSelection },
      );

      expect(result.type).toBe('final');
      if (result.type !== 'final') return;

      const changeOutputs = result.outputs.filter(output => output.isChange);
      expect(changeOutputs.length).toBeGreaterThan(1);
      expect(
        changeOutputs.every(
          output =>
            CardanoWasm.Value.new(
              BigInt(output.amount),
              utils.buildMultiAsset(output.assets),
            ).to_cbor_bytes().length <= 5000,
        ),
      ).toBe(true);

      const inputAssets = inputUtxos.flatMap(utxo =>
        utxo.amount.filter(asset => asset.unit !== 'lovelace'),
      );
      const changeAssets = changeOutputs.flatMap(output => output.assets);
      expect(changeAssets).toEqual(inputAssets);

      const inputLovelace = inputUtxos.reduce(
        (sum, utxo) =>
          sum +
          BigInt(
            utxo.amount.find(asset => asset.unit === 'lovelace')!.quantity,
          ),
        BigInt(0),
      );
      const outputLovelace = result.outputs.reduce(
        (sum, output) => sum + BigInt(output.amount),
        BigInt(0),
      );
      expect(inputLovelace).toBe(outputLovelace + BigInt(result.fee));
    },
  );

  test('rejects oversized user output values', () => {
    const policyId = '02477d7c23b4c2834b0be8ca8578dde47af0cc82a964688f6fc95a7a';
    const assets = Array.from({ length: 142 }, (_, index) => ({
      quantity: '1',
      unit: `${policyId}${index.toString(16).padStart(64, '0')}`,
    }));
    const txBuilder = utils.getTxBuilder();

    expect(() =>
      utils.getOutputCost(
        txBuilder,
        { address: changeAddress, amount: '1000000', assets },
        changeAddress,
      ),
    ).toThrow('Max value size');
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
