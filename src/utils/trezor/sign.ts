import * as CardanoWasm from '../cardano';
import {
  CardanoSignedTxWitness,
  CardanoTxWitnessType,
} from '../../types/trezor';
import { getProtocolMagic } from '../common';

const SET_TAG = Buffer.from([0xd9, 0x01, 0x02]);

type CborHead = {
  major: number;
  length: number;
  end: number;
};

const readCborHead = (bytes: Buffer, offset: number): CborHead => {
  const first = bytes[offset];
  if (first === undefined) throw new Error('Invalid CBOR');

  const major = first >> 5;
  const additional = first & 0x1f;
  if (additional < 24) return { major, length: additional, end: offset + 1 };

  const byteLength =
    additional === 24
      ? 1
      : additional === 25
        ? 2
        : additional === 26
          ? 4
          : additional === 27
            ? 8
            : 0;
  if (byteLength === 0 || offset + 1 + byteLength > bytes.length) {
    throw new Error('Unsupported CBOR encoding');
  }

  let length = 0;
  for (let i = 0; i < byteLength; i += 1) {
    length = length * 256 + bytes[offset + 1 + i];
  }
  if (!Number.isSafeInteger(length))
    throw new Error('CBOR length exceeds the safe integer range');
  return { major, length, end: offset + 1 + byteLength };
};

const cborItemEnd = (bytes: Buffer, offset: number): number => {
  const head = readCborHead(bytes, offset);
  if (head.major === 0 || head.major === 1 || head.major === 7) return head.end;
  if (head.major === 2 || head.major === 3) return head.end + head.length;
  if (head.major === 6) return cborItemEnd(bytes, head.end);

  let end = head.end;
  const items =
    head.major === 4 ? head.length : head.major === 5 ? head.length * 2 : -1;
  if (items < 0) throw new Error('Unsupported CBOR item');
  for (let i = 0; i < items; i += 1) end = cborItemEnd(bytes, end);
  return end;
};

const tagSetValues = (
  bytes: Buffer,
  offset: number,
  setKeys: ReadonlySet<number>,
): Buffer => {
  const map = readCborHead(bytes, offset);
  if (map.major !== 5) throw new Error('Expected a CBOR map');

  const parts = [bytes.subarray(offset, map.end)];
  let cursor = map.end;
  for (let i = 0; i < map.length; i += 1) {
    const key = readCborHead(bytes, cursor);
    const keyEnd = cborItemEnd(bytes, cursor);
    parts.push(bytes.subarray(cursor, keyEnd));
    cursor = keyEnd;

    const valueEnd = cborItemEnd(bytes, cursor);
    const isAlreadyTagged =
      bytes[cursor] === SET_TAG[0] &&
      bytes[cursor + 1] === SET_TAG[1] &&
      bytes[cursor + 2] === SET_TAG[2];
    if (key.major === 0 && setKeys.has(key.length) && !isAlreadyTagged) {
      parts.push(SET_TAG);
    }
    parts.push(bytes.subarray(cursor, valueEnd));
    cursor = valueEnd;
  }
  return Buffer.concat(parts);
};

// Trezor signs the transaction-body encoding emitted by CSL, which wraps CDDL
// sets in CBOR tag 258. CML omits the optional tag for some parsed/construction
// paths while canonicalizing ordered sets with it. Normalize every body and
// witness field defined as a set at this boundary to preserve hashes/witnesses.
const preserveTrezorSetEncoding = (transaction: Uint8Array): Buffer => {
  const bytes = Buffer.from(transaction);
  const root = readCborHead(bytes, 0);
  if (root.major !== 4 || root.length < 2)
    throw new Error('Invalid transaction CBOR');

  const bodyStart = root.end;
  const bodyEnd = cborItemEnd(bytes, bodyStart);
  const witnessStart = bodyEnd;
  const witnessEnd = cborItemEnd(bytes, witnessStart);
  const body = tagSetValues(
    bytes,
    bodyStart,
    // inputs, certificates, collateral inputs, required signers, reference
    // inputs, and proposal procedures are CDDL sets.
    new Set([0, 4, 13, 14, 18, 20]),
  );
  const witnesses = tagSetValues(
    bytes,
    witnessStart,
    new Set([0, 1, 2, 3, 4, 6, 7]),
  );

  return Buffer.concat([
    bytes.subarray(0, bodyStart),
    body,
    witnesses,
    bytes.subarray(witnessEnd),
  ]);
};

export const signTransaction = (
  txBodyHex: string,
  // txMetadata: CardanoWasm.AuxiliaryData,
  signedWitnesses: CardanoSignedTxWitness[],
  options?: { testnet?: boolean },
): string => {
  const txBody = CardanoWasm.TransactionBody.from_cbor_bytes(
    Uint8Array.from(Buffer.from(txBodyHex, 'hex')),
  );
  const witnesses = CardanoWasm.TransactionWitnessSet.new();
  const vkeyWitnesses = CardanoWasm.VkeywitnessList.new();
  const bootstrapWitnesses = CardanoWasm.BootstrapWitnessList.new();

  signedWitnesses.forEach(w => {
    const vKey = CardanoWasm.PublicKey.from_bytes(Buffer.from(w.pubKey, 'hex'));
    const signature = CardanoWasm.Ed25519Signature.from_raw_bytes(
      Buffer.from(w.signature, 'hex'),
    );

    if (w.type === CardanoTxWitnessType.SHELLEY_WITNESS) {
      // Shelley witness
      const vKeyWitness = CardanoWasm.Vkeywitness.new(vKey, signature);
      vkeyWitnesses.add(vKeyWitness);
    } else if (w.type === CardanoTxWitnessType.BYRON_WITNESS) {
      // Byron witness
      if (w.chainCode) {
        const xpubHex = `${w.pubKey}${w.chainCode}`;
        const bip32Key = CardanoWasm.Bip32PublicKey.from_raw_bytes(
          Buffer.from(xpubHex, 'hex'),
        );
        const addressContent = CardanoWasm.AddressContent.icarus_from_key(
          bip32Key,
          getProtocolMagic(!!options?.testnet),
        );
        const bootstrapWitness = CardanoWasm.BootstrapWitness.new(
          vKey,
          signature,
          Buffer.from(w.chainCode, 'hex'),
          addressContent.addr_attributes(),
        );
        bootstrapWitnesses.add(bootstrapWitness);
      }
    }
  });

  if (bootstrapWitnesses.len() > 0) {
    witnesses.set_bootstrap_witnesses(bootstrapWitnesses);
  }
  if (vkeyWitnesses.len() > 0) {
    witnesses.set_vkeywitnesses(vkeyWitnesses);
  }

  const transaction = CardanoWasm.Transaction.new(txBody, witnesses, true);
  const serializedTx = preserveTrezorSetEncoding(
    transaction.to_cbor_bytes(),
  ).toString('hex');
  return serializedTx;
};
