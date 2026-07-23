import * as Cardano from '../../src/utils/cardano';
import {
  bigNumFromStr,
  buildMultiAsset,
  buildTxOutput,
  getNetworkId,
  getProtocolMagic,
  multiAssetToArray,
} from '../../src/utils/common';
import { DATA_COST_PER_UTXO_BYTE } from '../../src/constants';

describe('CML cardano adapter', () => {
  const shelleyAddress =
    'addr1q8u2f05rprqjhygz22m06mhy4xrnqvqqpyuzhmxqfxnwvxz8d2kd47hsre5v9urjyu8s0ryk38dxzw0t5jesncw4v90s22tk0f';

  test('preserves exact unsigned integer arithmetic', () => {
    const oneAda = bigNumFromStr('1000000');
    const halfAda = bigNumFromStr('500000');

    expect(oneAda.checked_add(halfAda).to_str()).toBe('1500000');
    expect(oneAda.checked_sub(halfAda).to_str()).toBe('500000');
    expect(halfAda.checked_mul(bigNumFromStr('3')).to_str()).toBe('1500000');
    expect(halfAda.clamped_sub(oneAda).to_str()).toBe('0');
    expect(oneAda.compare(halfAda)).toBe(1);
    expect(() => halfAda.checked_sub(oneAda)).toThrow('BigNum underflow');
  });

  test('keeps arithmetic exact beyond Number.MAX_SAFE_INTEGER', () => {
    const value = bigNumFromStr('9007199254740993123456789');

    expect(value.checked_add(bigNumFromStr('11')).to_str()).toBe(
      '9007199254740993123456800',
    );
    expect(value.checked_sub(bigNumFromStr('89')).to_str()).toBe(
      '9007199254740993123456700',
    );
    expect(value.checked_mul(bigNumFromStr('3')).to_str()).toBe(
      '27021597764222979370370367',
    );
  });

  test('uses the expected mainnet, preprod, and preview network constants', () => {
    expect(Cardano.NetworkInfo.mainnet().network_id()).toBe(1);
    expect(Cardano.NetworkInfo.mainnet().protocol_magic().to_int()).toBe(
      764824073,
    );
    expect(Cardano.NetworkInfo.preprod().network_id()).toBe(0);
    expect(Cardano.NetworkInfo.preprod().protocol_magic().to_int()).toBe(1);
    expect(Cardano.NetworkInfo.preview().network_id()).toBe(0);
    expect(Cardano.NetworkInfo.preview().protocol_magic().to_int()).toBe(2);

    expect(getNetworkId()).toBe(1);
    expect(getNetworkId(false)).toBe(1);
    expect(getNetworkId(true)).toBe(0);
    expect(getProtocolMagic().to_int()).toBe(764824073);
    expect(getProtocolMagic(false).to_int()).toBe(764824073);
    expect(getProtocolMagic(true).to_int()).toBe(2);
  });

  test('round-trips multi-assets with exact quantities', () => {
    const assets = [
      {
        unit: `${'00'.repeat(28)}544f4b454e`,
        quantity: '1234',
      },
    ];

    expect(multiAssetToArray(buildMultiAsset(assets))).toEqual(assets);
  });

  test('serializes transaction-body multi-assets in canonical CBOR key order', () => {
    const lowerPolicy = '11'.repeat(28);
    const higherPolicy = 'ee'.repeat(28);
    const output = buildTxOutput(
      {
        address: shelleyAddress,
        amount: '5000000',
        assets: [
          { unit: `${higherPolicy}01`, quantity: '1' },
          { unit: `${lowerPolicy}0001`, quantity: '2' },
          { unit: `${lowerPolicy}ff`, quantity: '3' },
        ],
      },
      shelleyAddress,
    );
    const inputs = Cardano.TransactionInputList.new();
    inputs.add(
      Cardano.TransactionInput.new(
        Cardano.TransactionHash.from_raw_bytes(Buffer.alloc(32)),
        BigInt(0),
      ),
    );
    const outputs = Cardano.TransactionOutputList.new();
    outputs.add(output);

    const body = Cardano.TransactionBody.new(inputs, outputs, BigInt(0));
    const bodyHex = body.to_cbor_hex();
    const lowerPolicyIndex = bodyHex.indexOf(`581c${lowerPolicy}`);
    const higherPolicyIndex = bodyHex.indexOf(`581c${higherPolicy}`);
    const shorterAssetNameIndex = bodyHex.indexOf('41ff');
    const longerAssetNameIndex = bodyHex.indexOf('420001');

    expect(lowerPolicyIndex).toBeGreaterThanOrEqual(0);
    expect(higherPolicyIndex).toBeGreaterThanOrEqual(0);
    expect(shorterAssetNameIndex).toBeGreaterThanOrEqual(0);
    expect(longerAssetNameIndex).toBeGreaterThanOrEqual(0);
    expect(bodyHex).toBe(body.to_canonical_cbor_hex());
    expect(lowerPolicyIndex).toBeLessThan(higherPolicyIndex);
    expect(shorterAssetNameIndex).toBeLessThan(longerAssetNameIndex);
  });

  test('builds a CML output with its exact minimum ADA requirement', () => {
    const output = buildTxOutput(
      {
        address: shelleyAddress,
        amount: '0',
        assets: [
          {
            unit: `${'00'.repeat(28)}544f4b454e`,
            quantity: '1234',
          },
        ],
      },
      shelleyAddress,
    );
    const minimum = Cardano.min_ada_required(output, DATA_COST_PER_UTXO_BYTE);

    expect(output.amount().coin()).toBe(minimum);
    expect(output.amount().multi_asset().policy_count()).toBe(1);
    expect(minimum).toBeGreaterThan(BigInt(0));
  });
});
