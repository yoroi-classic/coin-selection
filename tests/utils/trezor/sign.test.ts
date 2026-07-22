import * as CardanoWasm from '../../../src/utils/cardano';
import * as utils from '../../../src/utils/trezor/sign';
import * as fixtures from './fixtures/sign';
import { coinSelection as largestFirstFixtures } from '../../methods/fixtures/largestFirst';
import { CardanoTxWitnessType } from '../../../src/types/trezor';

describe('trezor sign utils', () => {
  fixtures.sign.forEach(f => {
    test(f.description, () => {
      const signedTx = utils.signTransaction(f.hex, f.witnesses, {
        testnet: f.testnet,
      });
      expect(
        utils.signTransaction(f.hex, f.witnesses, { testnet: f.testnet }),
      ).toBe(f.signedTx);

      const tx = CardanoWasm.Transaction.from_cbor_bytes(
        Buffer.from(signedTx, 'hex'),
      );
      const txhash = CardanoWasm.hash_transaction(tx.body()).to_hex();

      // just sanity check, signing shouldn't change the hash
      expect(txhash).toBe(f.txHash);
    });
  });

  test('restores set tags for a certificate-bearing transaction body', () => {
    const fixture = largestFirstFixtures.find(
      item => item.description === 'stake registration',
    );
    if (!fixture) throw new Error('Missing stake registration fixture');

    const taggedBody = fixture.result.tx.body;
    const untaggedBody = taggedBody.split('d90102').join('');
    const signedTx = utils.signTransaction(untaggedBody, []);
    const tx = CardanoWasm.Transaction.from_cbor_hex(signedTx);

    expect(tx.body().to_cbor_hex()).toBe(taggedBody);
    expect(CardanoWasm.hash_transaction(tx.body()).to_hex()).toBe(
      fixture.result.tx.hash,
    );
  });

  test('builds a deterministic Byron bootstrap witness from public data', () => {
    const fixture = fixtures.sign[0];
    const chainCode = '00'.repeat(32);
    const byronWitness = {
      type: CardanoTxWitnessType.BYRON_WITNESS,
      pubKey: fixture.witnesses[0].pubKey,
      signature: fixture.witnesses[0].signature,
      chainCode,
    };

    const signedTx = utils.signTransaction(fixture.hex, [byronWitness], {
      testnet: true,
    });
    expect(
      utils.signTransaction(fixture.hex, [byronWitness], { testnet: true }),
    ).toBe(signedTx);

    const tx = CardanoWasm.Transaction.from_cbor_hex(signedTx);
    const bootstrapWitnesses = tx.witness_set().bootstrap_witnesses();
    expect(bootstrapWitnesses?.len()).toBe(1);
    const witness = bootstrapWitnesses?.get(0);
    expect(
      Buffer.from(witness?.public_key().to_raw_bytes() ?? []).toString('hex'),
    ).toBe(byronWitness.pubKey);
    expect(
      Buffer.from(witness?.signature().to_raw_bytes() ?? []).toString('hex'),
    ).toBe(byronWitness.signature);
    expect(Buffer.from(witness?.chain_code() ?? []).toString('hex')).toBe(
      chainCode,
    );
    expect(witness?.attributes().protocol_magic()?.to_int()).toBe(2);
    expect(CardanoWasm.hash_transaction(tx.body()).to_hex()).toBe(
      fixture.txHash,
    );
  });
});
