import { coinSelection, DEFAULT_FEE_PARAMS, types } from '../../src';
import { TransactionBody } from '../../src/utils/cardano';
import {
  buildTxInput,
  buildTxOutput,
  getTxBuilder,
  outputBuilderResult,
} from '../../src/utils/common';
import { changeAddress, utxo1 } from '../fixtures/constants';
import { sanityCheck } from '../setup';

const accountPubKey =
  'ec8fdf616242f430855ad7477acda53395eb30c295f5a7ef038712578877375b5a2f00353c9c5cc88c7ff18e71dc08724d90fc238213b789c0b02438e336be07';
const policyId = 'ab'.repeat(28);

const createAssets = (
  count: number,
  lastNameLength?: number,
  shortNameIndexes: number[] = [],
): types.Asset[] =>
  Array.from({ length: count }, (_, index) => ({
    unit:
      policyId +
      index
        .toString(16)
        .padStart(
          (shortNameIndexes.includes(index)
            ? 31
            : index === count - 1 && lastNameLength !== undefined
              ? lastNameLength
              : 32) * 2,
          '0',
        ),
    quantity: index === count - 1 ? '100000' : '1',
  }));

const createUtxos = (adaPerInput: string, assets: types.Asset[]) => {
  const midpoint = Math.ceil(assets.length / 2);
  return [
    {
      ...utxo1,
      txHash: '11'.repeat(32),
      outputIndex: 0,
      amount: [
        { unit: 'lovelace', quantity: adaPerInput },
        ...assets.slice(0, midpoint),
      ],
    },
    {
      ...utxo1,
      txHash: '22'.repeat(32),
      outputIndex: 1,
      amount: [
        { unit: 'lovelace', quantity: adaPerInput },
        ...assets.slice(midpoint),
      ],
    },
  ];
};

const select = (
  utxos: ReturnType<typeof createUtxos>,
  amount: string,
  forceLargestFirst: boolean,
  requiredAsset?: types.Asset,
) =>
  coinSelection(
    {
      utxos,
      outputs: [
        {
          address: changeAddress,
          amount,
          assets: requiredAsset ? [requiredAsset] : [],
        },
      ],
      changeAddress,
      certificates: [],
      withdrawals: [],
      accountPubKey,
    },
    { forceLargestFirstSelection: forceLargestFirst },
  );

const assertFeeIsMinimumForSerializedTransaction = (
  result: Exclude<ReturnType<typeof select>, { type: 'nonfinal' }>,
) => {
  const txBuilder = getTxBuilder(DEFAULT_FEE_PARAMS.a);
  result.inputs.forEach(input =>
    txBuilder.add_input(buildTxInput(input).builderResult),
  );
  result.outputs.forEach(output =>
    txBuilder.add_output(
      outputBuilderResult(buildTxOutput(output, changeAddress)),
    ),
  );
  txBuilder.set_fee(BigInt(result.fee));
  expect(BigInt(result.fee)).toBe(txBuilder.min_fee(false));
};

test('rejects a result with an overpaid transaction fee', () => {
  const assets = createAssets(142, 20);
  const result = select(createUtxos('40000000', assets), '40500000', false);

  expect(result.type).toBe('final');
  if (result.type !== 'final') return;
  assertFeeIsMinimumForSerializedTransaction(result);

  const overpaidResult = {
    ...result,
    fee: (BigInt(result.fee) + BigInt(DEFAULT_FEE_PARAMS.a)).toString(),
  };
  expect(() =>
    assertFeeIsMinimumForSerializedTransaction(overpaidResult),
  ).toThrow();
});

describe.each([
  ['random-improve', false],
  ['largest-first', true],
])(
  'coin selection serialized value limit: %s',
  (_algorithm, forceLargestFirst) => {
    test('keeps a value exactly at the 5,000-byte boundary and charges its serialized fee', () => {
      const assets = createAssets(142, 20);
      const result = select(
        createUtxos('40000000', assets),
        '40500000',
        forceLargestFirst,
      );

      expect(result.type).toBe('final');
      if (result.type !== 'final') return;
      sanityCheck(result);
      const change = result.outputs.filter(output => output.isChange);
      expect(change).toHaveLength(1);
      const body = TransactionBody.from_cbor_bytes(
        Buffer.from(result.tx.body, 'hex'),
      );
      const changeIndex = result.outputs.findIndex(output => output.isChange);
      const changeOutput =
        changeIndex < 0 ? undefined : body.outputs().get(changeIndex);
      expect(changeOutput).toBeDefined();
      expect(changeOutput!.amount().to_cbor_bytes().length).toBe(5000);
      assertFeeIsMinimumForSerializedTransaction(result);
    });

    test('splits combined change assets so every value is within the protocol limit', () => {
      const assets = createAssets(200, undefined, [0, 1, 2, 100, 101, 102]);
      const result = select(
        createUtxos('40000000', assets),
        '30000000',
        forceLargestFirst,
        assets[assets.length - 1],
      );

      expect(result.type).toBe('final');
      if (result.type !== 'final') return;
      sanityCheck(result);
      const body = TransactionBody.from_cbor_bytes(
        Buffer.from(result.tx.body, 'hex'),
      );
      const changeOutputs = result.outputs.filter(output => output.isChange);
      expect(changeOutputs.length).toBeGreaterThan(1);
      for (const output of changeOutputs) {
        const outputIndex = result.outputs.indexOf(output);
        const value = body.outputs().get(outputIndex);
        expect(value.amount().to_cbor_bytes().length).toBeLessThanOrEqual(5000);
      }
      assertFeeIsMinimumForSerializedTransaction(result);
    });

    test('splits change just below 2^32 lovelace and charges each output fee', () => {
      const assets = createAssets(142, 20);
      const result = select(
        createUtxos('4400000000', assets),
        '4504864487',
        forceLargestFirst,
      );

      expect(result.type).toBe('final');
      if (result.type !== 'final') return;
      sanityCheck(result);
      const change = result.outputs.filter(output => output.isChange);
      expect(change).toHaveLength(2);
      assertFeeIsMinimumForSerializedTransaction(result);
    });
  },
);
