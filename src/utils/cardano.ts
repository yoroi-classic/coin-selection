import type * as SerializationLib from '@emurgo/cardano-serialization-lib-nodejs';

export const CARDANO_SERIALIZATION_COMPAT_EXPORTS = [
  'Address',
  'AssetName',
  'Assets',
  'BigNum',
  'Bip32PublicKey',
  'BootstrapWitness',
  'BootstrapWitnesses',
  'ByronAddress',
  'Certificate',
  'Certificates',
  'Credential',
  'DataCost',
  'DRep',
  'Ed25519KeyHash',
  'Ed25519Signature',
  'FixedTransaction',
  'LinearFee',
  'MultiAsset',
  'NetworkInfo',
  'PublicKey',
  'RewardAddress',
  'ScriptHash',
  'StakeDelegation',
  'StakeDeregistration',
  'StakeRegistration',
  'Transaction',
  'TransactionBody',
  'TransactionBuilder',
  'TransactionBuilderConfigBuilder',
  'TransactionHash',
  'TransactionInput',
  'TransactionOutput',
  'TransactionWitnessSet',
  'Value',
  'Vkey',
  'Vkeywitness',
  'Vkeywitnesses',
  'VoteDelegation',
  'Withdrawals',
  'min_ada_for_output',
] as const satisfies readonly (keyof typeof SerializationLib)[];

export type CardanoSerializationCompat = Pick<
  typeof SerializationLib,
  (typeof CARDANO_SERIALIZATION_COMPAT_EXPORTS)[number]
>;

export * from '@emurgo/cardano-serialization-lib-nodejs';
