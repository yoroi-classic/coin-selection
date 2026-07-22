import * as CardanoWasm from './cardano';
import {
  CARDANO_PARAMS,
  CertificateType,
  DATA_COST_PER_UTXO_BYTE,
  ERROR,
  MAX_TOKENS_PER_OUTPUT,
} from '../constants';
import {
  Certificate,
  Output,
  Utxo,
  Withdrawal,
  OutputCost,
  UserOutput,
  Asset,
  ChangeOutput,
  CardanoDRepType,
} from '../types/types';
import { CoinSelectionError } from './errors';

export const bigNumFromStr = (num: string): CardanoWasm.BigNum =>
  CardanoWasm.BigNum.from_str(num);

export const bigNumFromBigInt = (num: bigint): CardanoWasm.BigNum =>
  CardanoWasm.BigNum.from_bigint(num);

export const outputBuilderResult = (
  output: CardanoWasm.TransactionOutput,
): CardanoWasm.SingleOutputBuilderResult =>
  CardanoWasm.SingleOutputBuilderResult.new(output);

export const getProtocolMagic = (
  tesnet?: boolean,
):
  | (typeof CARDANO_PARAMS.PROTOCOL_MAGICS)['mainnet']
  | (typeof CARDANO_PARAMS.PROTOCOL_MAGICS)['testnet_preview']
  | (typeof CARDANO_PARAMS.PROTOCOL_MAGICS)['testnet_preprod'] =>
  tesnet
    ? CARDANO_PARAMS.PROTOCOL_MAGICS.testnet_preview
    : CARDANO_PARAMS.PROTOCOL_MAGICS.mainnet;

export const getNetworkId = (
  testnet?: boolean,
):
  | (typeof CARDANO_PARAMS.NETWORK_IDS)['mainnet']
  | (typeof CARDANO_PARAMS.NETWORK_IDS)['testnet_preprod']
  | (typeof CARDANO_PARAMS.NETWORK_IDS)['testnet_preview'] =>
  testnet
    ? CARDANO_PARAMS.NETWORK_IDS.testnet_preview
    : CARDANO_PARAMS.NETWORK_IDS.mainnet;

export const parseAsset = (
  hex: string,
): {
  policyId: string;
  assetNameInHex: string;
} => {
  const policyIdSize = 56;
  const policyId = hex.slice(0, policyIdSize);
  const assetNameInHex = hex.slice(policyIdSize);
  return {
    policyId,
    assetNameInHex,
  };
};

export const buildMultiAsset = (assets: Asset[]): CardanoWasm.MultiAsset => {
  const multiAsset = CardanoWasm.MultiAsset.new();
  assets.forEach(assetEntry => {
    const { policyId, assetNameInHex } = parseAsset(assetEntry.unit);
    multiAsset.set(
      CardanoWasm.ScriptHash.from_raw_bytes(Buffer.from(policyId, 'hex')),
      CardanoWasm.AssetName.from_raw_bytes(Buffer.from(assetNameInHex, 'hex')),
      BigInt(assetEntry.quantity || '0'), // fallback for an empty string
    );
  });
  return multiAsset;
};

export const multiAssetToArray = (
  multiAsset: CardanoWasm.MultiAsset | undefined,
): Asset[] => {
  if (!multiAsset) return [];
  const assetsArray: Asset[] = [];
  const policyHashes = multiAsset.keys();

  for (let i = 0; i < policyHashes.len(); i++) {
    const policyId = policyHashes.get(i);
    const assetsInPolicy = multiAsset.get_assets(policyId);
    if (!assetsInPolicy) continue;

    const assetNames = assetsInPolicy.keys();
    for (let j = 0; j < assetNames.len(); j++) {
      const assetName = assetNames.get(j);
      const amount = assetsInPolicy.get(assetName);
      if (amount === undefined) continue;

      const policyIdHex = Buffer.from(policyId.to_raw_bytes()).toString('hex');
      const assetNameHex = Buffer.from(assetName.to_raw_bytes()).toString(
        'hex',
      );

      assetsArray.push({
        quantity: amount.toString(),
        unit: `${policyIdHex}${assetNameHex}`,
      });
    }
  }
  return assetsArray;
};

export const getAssetAmount = (
  obj: Pick<Utxo, 'amount'>,
  asset = 'lovelace',
): string => obj.amount.find(a => a.unit === asset)?.quantity ?? '0';

export const getUtxoQuantity = (
  utxos: Utxo[],
  asset = 'lovelace',
): CardanoWasm.BigNum =>
  utxos.reduce(
    (acc, utxo) => acc.checked_add(bigNumFromStr(getAssetAmount(utxo, asset))),
    bigNumFromStr('0'),
  );

export const getOutputQuantity = (
  outputs: Output[],
  asset = 'lovelace',
): CardanoWasm.BigNum => {
  if (asset === 'lovelace') {
    return outputs.reduce(
      (acc, output) => acc.checked_add(bigNumFromStr(output.amount ?? '0')),
      bigNumFromStr('0'),
    );
  }
  return outputs.reduce(
    (acc, output) =>
      acc.checked_add(
        bigNumFromStr(
          output.assets?.find(a => a.unit === asset)?.quantity ?? '0',
        ),
      ),
    bigNumFromStr('0'),
  );
};

export const sortUtxos = (utxos: Utxo[], asset = 'lovelace'): Utxo[] => {
  const copy: Utxo[] = JSON.parse(JSON.stringify(utxos));
  return copy.sort((u1, u2) =>
    bigNumFromStr(getAssetAmount(u2, asset)).compare(
      bigNumFromStr(getAssetAmount(u1, asset)),
    ),
  );
};

export const buildTxInput = (
  utxo: Utxo,
): {
  input: CardanoWasm.TransactionInput;
  address: CardanoWasm.Address;
  amount: CardanoWasm.Value;
  builderResult: CardanoWasm.InputBuilderResult;
} => {
  const input = CardanoWasm.TransactionInput.new(
    CardanoWasm.TransactionHash.from_raw_bytes(Buffer.from(utxo.txHash, 'hex')),
    BigInt(utxo.outputIndex),
  );

  let amount = CardanoWasm.Value.from_coin(BigInt(getAssetAmount(utxo)));
  const assets = utxo.amount.filter(a => a.unit !== 'lovelace');
  if (assets.length > 0) {
    const multiAsset = buildMultiAsset(assets);
    amount = CardanoWasm.Value.new(amount.coin(), multiAsset);
  }

  const address = CardanoWasm.Address.from_bech32(utxo.address);

  const builderResult = CardanoWasm.SingleInputBuilder.new(
    input,
    CardanoWasm.TransactionOutput.new(address, amount),
  ).payment_key();

  return { input, address, amount, builderResult };
};

export const buildTxOutput = (
  output: Output,
  dummyAddress: string,
): CardanoWasm.TransactionOutput => {
  // If output.address was not defined fallback to bech32 address (useful for "precompose" tx
  // which doesn't have all necessary data, but we can fill in the blanks and return some info such as fee)
  const outputAddr =
    output.address && CardanoWasm.ByronAddress.is_valid(output.address)
      ? CardanoWasm.ByronAddress.from_base58(output.address).to_address()
      : CardanoWasm.Address.from_bech32(output.address ?? dummyAddress);

  // Set initial amount
  const outputAmount = output.amount
    ? bigNumFromStr(output.amount)
    : bigNumFromStr('0');

  // Create Value including assets
  let outputValue = CardanoWasm.Value.from_coin(outputAmount.to_bigint());
  const multiAsset =
    output.assets.length > 0 ? buildMultiAsset(output.assets) : null;
  if (multiAsset) {
    outputValue = CardanoWasm.Value.new(outputAmount.to_bigint(), multiAsset);
  }

  // Calculate min required ADA for the output
  let txOutput = CardanoWasm.TransactionOutput.new(outputAddr, outputValue);
  const minAdaRequired = bigNumFromBigInt(
    CardanoWasm.min_ada_required(txOutput, DATA_COST_PER_UTXO_BYTE),
  );

  // If calculated min required ada is greater than current output value than adjust it
  if (outputAmount.compare(minAdaRequired) < 0) {
    outputValue = CardanoWasm.Value.from_coin(minAdaRequired.to_bigint());
    if (multiAsset) {
      outputValue = CardanoWasm.Value.new(
        minAdaRequired.to_bigint(),
        multiAsset,
      );
    }
    txOutput = CardanoWasm.TransactionOutput.new(outputAddr, outputValue);
  }

  return txOutput;
};

export const getOutputCost = (
  txBuilder: CardanoWasm.TransactionBuilder,
  output: Output,
  dummyAddress: string,
): OutputCost => {
  const txOutput = buildTxOutput(output, dummyAddress);
  const outputFee = bigNumFromBigInt(
    txBuilder.fee_for_output(outputBuilderResult(txOutput)),
  );
  const minAda = bigNumFromBigInt(
    CardanoWasm.min_ada_required(txOutput, DATA_COST_PER_UTXO_BYTE),
  );

  return {
    output: txOutput,
    outputFee,
    minOutputAmount: minAda, // should match https://cardano-ledger.readthedocs.io/en/latest/explanations/min-utxo.html
  };
};

export const prepareWithdrawals = (
  withdrawals: Withdrawal[],
): CardanoWasm.WithdrawalBuilderResult[] => {
  const preparedWithdrawals: CardanoWasm.WithdrawalBuilderResult[] = [];

  withdrawals.forEach(withdrawal => {
    const rewardAddress = CardanoWasm.RewardAddress.from_address(
      CardanoWasm.Address.from_bech32(withdrawal.stakeAddress),
    );

    if (rewardAddress) {
      preparedWithdrawals.push(
        CardanoWasm.SingleWithdrawalBuilder.new(
          rewardAddress,
          BigInt(withdrawal.amount),
        ).payment_key(),
      );
    }
  });

  return preparedWithdrawals;
};

export const prepareCertificates = (
  certificates: Certificate[],
  accountKey: CardanoWasm.Bip32PublicKey,
): CardanoWasm.CertificateBuilderResult[] => {
  const preparedCertificates: CardanoWasm.CertificateBuilderResult[] = [];
  if (certificates.length === 0) return preparedCertificates;

  const stakeKey = accountKey.derive(2).derive(0);
  const stakeCred = CardanoWasm.Credential.new_pub_key(
    stakeKey.to_raw_key().hash(),
  );

  certificates.forEach(cert => {
    if (cert.type === CertificateType.STAKE_REGISTRATION) {
      preparedCertificates.push(
        CardanoWasm.SingleCertificateBuilder.new(
          CardanoWasm.Certificate.new_stake_registration(stakeCred),
        ).skip_witness(),
      );
    } else if (cert.type === CertificateType.STAKE_DELEGATION) {
      preparedCertificates.push(
        CardanoWasm.SingleCertificateBuilder.new(
          CardanoWasm.Certificate.new_stake_delegation(
            stakeCred,
            CardanoWasm.Ed25519KeyHash.from_raw_bytes(
              Buffer.from(cert.pool, 'hex'),
            ),
          ),
        ).payment_key(),
      );
    } else if (cert.type === CertificateType.STAKE_DEREGISTRATION) {
      preparedCertificates.push(
        CardanoWasm.SingleCertificateBuilder.new(
          CardanoWasm.Certificate.new_stake_deregistration(stakeCred),
        ).payment_key(),
      );
    } else if (cert.type === CertificateType.VOTE_DELEGATION) {
      let targetDRep: CardanoWasm.DRep;
      switch (cert.dRep.type) {
        case CardanoDRepType.ABSTAIN:
          targetDRep = CardanoWasm.DRep.new_always_abstain();
          break;
        case CardanoDRepType.NO_CONFIDENCE:
          targetDRep = CardanoWasm.DRep.new_always_no_confidence();
          break;
        case CardanoDRepType.KEY_HASH:
          targetDRep = CardanoWasm.DRep.new_key(
            CardanoWasm.Ed25519KeyHash.from_hex(cert.dRep.keyHash),
          );
          break;
        case CardanoDRepType.SCRIPT_HASH:
          targetDRep = CardanoWasm.DRep.new_script(
            CardanoWasm.ScriptHash.from_hex(cert.dRep.scriptHash),
          );
          break;
      }

      if (targetDRep) {
        preparedCertificates.push(
          CardanoWasm.SingleCertificateBuilder.new(
            CardanoWasm.Certificate.new_vote_deleg_cert(stakeCred, targetDRep),
          ).payment_key(),
        );
      }
    } else {
      throw new CoinSelectionError(ERROR.UNSUPPORTED_CERTIFICATE_TYPE);
    }
  });
  return preparedCertificates;
};

export const calculateRequiredDeposit = (
  certificates: Certificate[],
): number => {
  const CertificateDeposit = {
    [CertificateType.STAKE_DELEGATION]: 0,
    [CertificateType.VOTE_DELEGATION]: 0,
    [CertificateType.STAKE_POOL_REGISTRATION]: 500000000,
    [CertificateType.STAKE_REGISTRATION]: 2000000,
    [CertificateType.STAKE_DEREGISTRATION]: -2000000,
  } as const;
  return certificates.reduce(
    (acc, cert) => (acc += CertificateDeposit[cert.type]),
    0,
  );
};

export const setMinUtxoValueForOutputs = (
  txBuilder: CardanoWasm.TransactionBuilder,
  outputs: UserOutput[],
  dummyAddress: string,
): UserOutput[] => {
  const preparedOutputs = outputs.map(output => {
    // sets minimal output ADA amount in case of multi-asset output
    const { minOutputAmount } = getOutputCost(txBuilder, output, dummyAddress);
    const outputAmount = bigNumFromStr(output.amount || '0');

    let amount: string | undefined;
    if (output.assets.length > 0 && outputAmount.compare(minOutputAmount) < 0) {
      // output with an asset(s) adjust minimum ADA to met network requirements
      amount = minOutputAmount.to_str();
    } else {
      amount = output.amount;
    }

    if (
      !output.setMax &&
      output.assets.length === 0 &&
      output.amount &&
      outputAmount.compare(minOutputAmount) < 0
    ) {
      // Case of an output without any asset, and without setMax = true
      // If the user entered less than min utxo val then throw an error (won't throw if there is no amount yet)
      // (On outputs with setMax flag we set '0' on purpose)
      // (On outputs with an asset we automatically adjust ADA amount if it is below required minimum)
      throw new CoinSelectionError(ERROR.UTXO_VALUE_TOO_SMALL);
    }

    if (output.setMax) {
      // if setMax is active set initial value to 0
      if (output.assets.length > 0) {
        output.assets[0].quantity = '0';
      } else {
        amount = '0';
      }
    }

    return {
      ...output,
      // if output contains assets make sure that minUtxoValue is at least minOutputAmount (even for output where we want to setMax)
      amount,
    } as UserOutput;
  });
  return preparedOutputs;
};

export const splitChangeOutput = (
  txBuilder: CardanoWasm.TransactionBuilder,
  singleChangeOutput: OutputCost,
  changeAddress: string,
  maxTokensPerOutput = MAX_TOKENS_PER_OUTPUT,
): OutputCost[] => {
  // TODO: https://github.com/Emurgo/cardano-serialization-lib/pull/236
  const multiAsset = singleChangeOutput.output.amount().multi_asset();
  const allAssets = multiAssetToArray(multiAsset);
  if (allAssets.length <= maxTokensPerOutput) {
    return [singleChangeOutput];
  }

  let lovelaceAvailable = bigNumFromBigInt(
    singleChangeOutput.output.amount().coin(),
  ).checked_add(singleChangeOutput.outputFee);

  const nAssetBundles = Math.ceil(allAssets.length / maxTokensPerOutput);

  const changeOutputs: ChangeOutput[] = [];
  // split change output to multiple outputs, where each bundle has maximum of maxTokensPerOutput assets
  for (let i = 0; i < nAssetBundles; i++) {
    const assetsBundle = allAssets.slice(
      i * maxTokensPerOutput,
      (i + 1) * maxTokensPerOutput,
    );

    const outputValue = CardanoWasm.Value.new(
      BigInt(0),
      buildMultiAsset(assetsBundle),
    );
    const txOutput = CardanoWasm.TransactionOutput.new(
      CardanoWasm.Address.from_bech32(changeAddress),
      outputValue,
    );

    const minAdaRequired = bigNumFromBigInt(
      CardanoWasm.min_ada_required(txOutput, DATA_COST_PER_UTXO_BYTE),
    );

    changeOutputs.push({
      isChange: true,
      address: changeAddress,
      amount: minAdaRequired.to_str(),
      assets: assetsBundle,
    });
  }

  const changeOutputsCost = changeOutputs.map((partialChange, i) => {
    let changeOutputCost = getOutputCost(
      txBuilder,
      partialChange,
      changeAddress,
    );
    lovelaceAvailable = lovelaceAvailable.clamped_sub(
      bigNumFromStr(partialChange.amount).checked_add(
        changeOutputCost.outputFee,
      ),
    );

    if (i === changeOutputs.length - 1) {
      // add all unused ADA to the last change output
      let changeOutputAmount = lovelaceAvailable.checked_add(
        bigNumFromStr(partialChange.amount),
      );

      if (changeOutputAmount.compare(changeOutputCost.minOutputAmount) < 0) {
        // computed change amount would be below minUtxoValue
        // set change output amount to met minimum requirements for minUtxoValue
        changeOutputAmount = changeOutputCost.minOutputAmount;
      }
      partialChange.amount = changeOutputAmount.to_str();
      changeOutputCost = getOutputCost(txBuilder, partialChange, changeAddress);
    }
    return changeOutputCost;
  });

  return changeOutputsCost;
};

export const prepareChangeOutput = (
  txBuilder: CardanoWasm.TransactionBuilder,
  usedUtxos: Utxo[],
  preparedOutputs: Output[],
  changeAddress: string,
  utxosTotalAmount: CardanoWasm.BigNum,
  totalOutputAmount: CardanoWasm.BigNum,
  totalFeesAmount: CardanoWasm.BigNum,
  pickAdditionalUtxo?: () => ReturnType<typeof getRandomUtxo>,
): OutputCost | null => {
  // change output amount should be lowered by the cost of the change output (fee + minUtxoVal)
  // The cost will be subtracted once we calculate it.
  const placeholderChangeOutputAmount = utxosTotalAmount.clamped_sub(
    totalFeesAmount.checked_add(totalOutputAmount),
  );
  const uniqueAssets: string[] = [];
  usedUtxos.forEach(utxo => {
    const assets = utxo.amount.filter(a => a.unit !== 'lovelace');
    assets.forEach(asset => {
      if (!uniqueAssets.includes(asset.unit)) {
        uniqueAssets.push(asset.unit);
      }
    });
  });

  const changeOutputAssets = uniqueAssets
    .map(assetUnit => {
      const assetInputAmount = getUtxoQuantity(usedUtxos, assetUnit);
      const assetSpentAmount = getOutputQuantity(preparedOutputs, assetUnit);
      return {
        unit: assetUnit,
        quantity: assetInputAmount.clamped_sub(assetSpentAmount).to_str(),
      };
    })
    .filter(asset => asset.quantity !== '0');

  const changeOutputCost = getOutputCost(
    txBuilder,
    {
      address: changeAddress,
      amount: placeholderChangeOutputAmount.to_str(),
      assets: changeOutputAssets,
    },
    changeAddress,
  );

  // calculate change output amount as utxosTotalAmount - totalOutputAmount - totalFeesAmount - change output fee
  const totalSpent = totalOutputAmount
    .checked_add(totalFeesAmount)
    .checked_add(changeOutputCost.outputFee);
  let changeOutputAmount = utxosTotalAmount.clamped_sub(totalSpent);

  // Sum of all tokens in utxos must be same as sum of the tokens in external + change outputs
  // If computed change output doesn't contain any tokens then it makes sense to add it only if the fee + minUtxoValue is less then the amount
  let isChangeOutputNeeded = false;
  if (
    changeOutputAssets.length > 0 ||
    changeOutputAmount.compare(changeOutputCost.minOutputAmount) >= 0
  ) {
    isChangeOutputNeeded = true;
  } else if (
    pickAdditionalUtxo &&
    changeOutputAmount.compare(bigNumFromStr('5000')) >= 0
  ) {
    // change amount is above our constant (0.005 ADA), but still less than required minUtxoValue
    // try to add another utxo recalculate change again
    const utxo = pickAdditionalUtxo();
    if (utxo) {
      utxo.addUtxo();
      const newTotalFee = bigNumFromBigInt(txBuilder.min_fee(false));
      return prepareChangeOutput(
        txBuilder,
        usedUtxos,
        preparedOutputs,
        changeAddress,
        getUtxoQuantity(usedUtxos, 'lovelace'),
        totalOutputAmount,
        newTotalFee,
        pickAdditionalUtxo,
      );
    }
  }

  if (isChangeOutputNeeded) {
    if (changeOutputAmount.compare(changeOutputCost.minOutputAmount) < 0) {
      // computed change amount would be below minUtxoValue
      // set change output amount to met minimum requirements for minUtxoValue
      changeOutputAmount = changeOutputCost.minOutputAmount;
    }

    // TODO: changeOutputCost.output.amount().set_coin(changeOutputAmount)?
    const txOutput = buildTxOutput(
      {
        amount: changeOutputAmount.to_str(),
        address: changeAddress,
        assets: changeOutputAssets,
      },
      changeAddress,
    );

    // WARNING: It returns a change output also in a case where we don't have enough utxos to cover the output cost, but the change output is needed because it contains additional assets
    return {
      outputFee: changeOutputCost.outputFee,
      minOutputAmount: changeOutputCost.minOutputAmount,
      output: txOutput,
    };
  }
  // Change output not needed
  return null;
};

export const getTxBuilder = (a = '44'): CardanoWasm.TransactionBuilder =>
  CardanoWasm.TransactionBuilder.new(
    CardanoWasm.TransactionBuilderConfigBuilder.new()
      .fee_algo(CardanoWasm.LinearFee.new(BigInt(a), BigInt(155381), BigInt(0)))
      .pool_deposit(BigInt(500000000))
      .key_deposit(BigInt(2000000))
      .coins_per_utxo_byte(BigInt(CARDANO_PARAMS.COINS_PER_UTXO_BYTE))
      .max_value_size(CARDANO_PARAMS.MAX_VALUE_SIZE)
      .max_tx_size(CARDANO_PARAMS.MAX_TX_SIZE)
      .prefer_pure_change(false)
      .ex_unit_prices(
        CardanoWasm.ExUnitPrices.new(
          CardanoWasm.Rational.new(BigInt(0), BigInt(1)),
          CardanoWasm.Rational.new(BigInt(0), BigInt(1)),
        ),
      )
      .cost_models(CardanoWasm.CostModels.from_json('{}'))
      .collateral_percentage(150)
      .max_collateral_inputs(3)
      .build(),
  );

export const getUnsatisfiedAssets = (
  selectedUtxos: Utxo[],
  outputs: Output[],
): string[] => {
  const assets: string[] = [];

  outputs.forEach(output => {
    if (output.assets.length > 0) {
      const asset = output.assets[0];
      const assetAmountInUtxos = getUtxoQuantity(selectedUtxos, asset.unit);
      if (assetAmountInUtxos.compare(bigNumFromStr(asset.quantity)) < 0) {
        assets.push(asset.unit);
      }
    }
  });

  const lovelaceUtxo = getUtxoQuantity(selectedUtxos, 'lovelace');
  if (lovelaceUtxo.compare(getOutputQuantity(outputs, 'lovelace')) < 0) {
    assets.push('lovelace');
  }

  return assets;
};

export const getInitialUtxoSet = (
  utxos: Utxo[],
  maxOutput: UserOutput | undefined,
): {
  used: Utxo[];
  remaining: Utxo[];
} => {
  // Picks all utxos containing an asset on which the user requested to set maximum value
  if (!maxOutput)
    return {
      used: [],
      remaining: utxos,
    };

  const used: Utxo[] = [];
  const remaining: Utxo[] = [];

  const maxOutputAsset = maxOutput.assets[0]?.unit ?? 'lovelace';
  // either all UTXOs will be used (send max for ADA output) or initial set of used utxos will contain all utxos containing given token
  utxos.forEach(u => {
    if (u.amount.find(a => a.unit === maxOutputAsset)) {
      used.push(u);
    } else {
      remaining.push(u);
    }
  });
  return {
    used,
    remaining,
  };
};

export const setMaxOutput = (
  txBuilder: CardanoWasm.TransactionBuilder,
  maxOutput: UserOutput,
  changeOutput: OutputCost | null,
): {
  maxOutput: UserOutput;
} => {
  const maxOutputAsset = maxOutput.assets[0]?.unit ?? 'lovelace';
  let newMaxAmount = bigNumFromStr('0');

  const changeOutputAssets = multiAssetToArray(
    changeOutput?.output.amount().multi_asset(),
  );

  if (maxOutputAsset === 'lovelace') {
    // set maxOutput for ADA
    if (changeOutput) {
      // Calculate the cost of previous dummy set-max output
      const previousMaxOutputCost = getOutputCost(
        txBuilder,
        maxOutput,
        maxOutput.address ?? changeOutput.output.address().to_bech32(),
      );
      newMaxAmount = bigNumFromBigInt(changeOutput.output.amount().coin());

      if (changeOutputAssets.length === 0) {
        // Add a fee that was previously consumed by the dummy max output.
        // Cost calculated for the change output will be greater (due to larger coin amount
        // than in dummy output - which is 0) than the cost of the dummy set-max output.
        newMaxAmount = newMaxAmount.checked_add(
          previousMaxOutputCost.outputFee,
        );
        changeOutput = null;
      } else {
        newMaxAmount = newMaxAmount.clamped_sub(changeOutput.minOutputAmount);

        const txOutput = CardanoWasm.TransactionOutput.new(
          changeOutput.output.address(),
          CardanoWasm.Value.from_coin(newMaxAmount.to_bigint()),
        );
        const minUtxoVal = bigNumFromBigInt(
          CardanoWasm.min_ada_required(txOutput, DATA_COST_PER_UTXO_BYTE),
        );

        if (newMaxAmount.compare(minUtxoVal) < 0) {
          // the amount would be less than min required ADA
          throw new CoinSelectionError(ERROR.UTXO_BALANCE_INSUFFICIENT);
        }
      }
    }
    maxOutput.amount = newMaxAmount.to_str();
  } else {
    // set maxOutput for token
    if (changeOutput) {
      // max amount of the asset in output is equal to its quantity in change output
      newMaxAmount = bigNumFromStr(
        changeOutputAssets.find(a => a.unit === maxOutputAsset)?.quantity ??
          '0',
      );
      maxOutput.assets[0].quantity = newMaxAmount.to_str(); // TODO: set 0 if no change?

      const txOutput = CardanoWasm.TransactionOutput.new(
        changeOutput.output.address(),
        CardanoWasm.Value.new(BigInt(0), buildMultiAsset(maxOutput.assets)),
      );

      // adjust ADA amount to cover min ada for the asset
      maxOutput.amount = CardanoWasm.min_ada_required(
        txOutput,
        DATA_COST_PER_UTXO_BYTE,
      ).toString();
    }
  }

  return { maxOutput };
};

export const getUserOutputQuantityWithDeposit = (
  outputs: UserOutput[],
  deposit: number,
  asset = 'lovelace',
): CardanoWasm.BigNum => {
  let amount = getOutputQuantity(outputs, asset);
  if (deposit > 0) {
    amount = amount.checked_add(bigNumFromStr(deposit.toString()));
  }
  return amount;
};

export const filterUtxos = (utxos: Utxo[], asset: string): Utxo[] => {
  return utxos.filter(utxo => utxo.amount.find(a => a.unit === asset));
};

export const getRandomUtxo = (
  txBuilder: CardanoWasm.TransactionBuilder,
  utxoRemaining: Utxo[],
  utxoSelected: Utxo[],
): {
  utxo: Utxo;
  addUtxo: () => void;
} | null => {
  const index = Math.floor(Math.random() * utxoRemaining.length);
  const utxo = utxoRemaining[index];

  if (!utxo) return null;
  return {
    utxo,
    addUtxo: () => {
      utxoSelected.push(utxo);
      const { builderResult } = buildTxInput(utxo);
      txBuilder.add_input(builderResult);
      utxoRemaining.splice(utxoRemaining.indexOf(utxo), 1);
    },
  };
};

export const calculateUserOutputsFee = (
  txBuilder: CardanoWasm.TransactionBuilder,
  userOutputs: UserOutput[],
  changeAddress: string,
) => {
  // Calculate fee and minUtxoValue for all external outputs
  const outputsCost = userOutputs.map(output =>
    getOutputCost(txBuilder, output, changeAddress),
  );

  const totalOutputsFee = outputsCost.reduce(
    (acc, output) => (acc = acc.checked_add(output.outputFee)),
    bigNumFromStr('0'),
  );

  return totalOutputsFee;
};

export const orderInputs = (
  inputsToOrder: Utxo[],
  txBody: CardanoWasm.TransactionBody,
): Utxo[] => {
  // reorder inputs to match order within tx
  const orderedInputs: Utxo[] = [];
  for (let i = 0; i < txBody.inputs().len(); i++) {
    const txid = Buffer.from(
      txBody.inputs().get(i).transaction_id().to_raw_bytes(),
    ).toString('hex');
    const outputIndex = Number(txBody.inputs().get(i).index());
    const utxo = inputsToOrder.find(
      uu => uu.txHash === txid && uu.outputIndex === outputIndex,
    );
    if (!utxo) {
      throw new Error(
        'Failed to order the utxos to match the order of inputs in constructed tx. THIS SHOULD NOT HAPPEN',
      );
    }
    orderedInputs.push(utxo);
  }
  return orderedInputs;
};
