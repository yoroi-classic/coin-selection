import { bech32 } from 'bech32';

import {
  CardanoAddressParameters,
  CardanoInput,
  CardanoOutput,
} from '../../types/trezor';
import { Asset, CardanoDRepType, FinalOutput, Utxo } from '../../types/types';
import { parseAsset } from '../common';

interface AssetInPolicy {
  assetNameBytes: string;
  amount: string;
}
export const transformToTokenBundle = (assets: Asset[]) => {
  // prepare token bundle used in trezor output
  if (assets.length === 0) return undefined;

  const uniquePolicies: string[] = [];
  assets.forEach(asset => {
    const { policyId } = parseAsset(asset.unit);
    if (!uniquePolicies.includes(policyId)) {
      uniquePolicies.push(policyId);
    }
  });

  const assetsByPolicy: {
    policyId: string;
    tokenAmounts: AssetInPolicy[];
  }[] = [];
  uniquePolicies.forEach(policyId => {
    const assetsInPolicy: AssetInPolicy[] = [];
    assets.forEach(asset => {
      const assetInfo = parseAsset(asset.unit);
      if (assetInfo.policyId !== policyId) return;

      assetsInPolicy.push({
        assetNameBytes: assetInfo.assetNameInHex,
        amount: asset.quantity,
      });
    }),
      assetsByPolicy.push({
        policyId,
        tokenAmounts: assetsInPolicy,
      });
  });

  return assetsByPolicy;
};

export const transformToTrezorInputs = (
  utxos: Utxo[],
  trezorUtxos: { txid: string; vout: number; path: string }[],
): CardanoInput[] => {
  return utxos.map(utxo => {
    const utxoWithPath = trezorUtxos.find(
      u => u.txid === utxo.txHash && u.vout === utxo.outputIndex,
    );
    // shouldn't happen since utxos should be subset of trezorUtxos (with different shape/fields)
    if (!utxoWithPath)
      throw Error(`Cannot transform utxo ${utxo.txHash}:${utxo.outputIndex}`);

    return {
      path: utxoWithPath.path,
      prev_hash: utxo.txHash,
      prev_index: utxo.outputIndex,
    };
  });
};

export const transformToTrezorOutputs = (
  outputs: FinalOutput[],
  changeAddressParameters: CardanoAddressParameters,
): CardanoOutput[] => {
  return outputs.map(output => {
    let params:
      | { address: string }
      | { addressParameters: CardanoAddressParameters };

    if (output.isChange) {
      params = {
        addressParameters: changeAddressParameters,
      };
    } else {
      params = {
        address: output.address,
      };
    }

    return {
      ...params,
      amount: output.amount,
      tokenBundle: transformToTokenBundle(output.assets),
    };
  });
};

export const drepIdToHex = (
  drepId: string,
): {
  type: CardanoDRepType.KEY_HASH | CardanoDRepType.SCRIPT_HASH;
  hex: string;
} => {
  const decoded = bech32.decode(drepId, 128);
  const bytes = bech32.fromWords(decoded.words);
  const kind =
    decoded.prefix === 'drep'
      ? CardanoDRepType.KEY_HASH
      : decoded.prefix === 'drep_script'
        ? CardanoDRepType.SCRIPT_HASH
        : undefined;

  if (kind === undefined || bytes.length !== 28) {
    throw Error('Invalid drepId');
  }

  return {
    type: kind,
    hex: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''),
  };
};
