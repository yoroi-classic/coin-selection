import { CoinSelectionError, coinSelection, trezorUtils, types } from '../src';

describe('public API', () => {
  test('loads the coin selection and Trezor exports', () => {
    expect(coinSelection).toEqual(expect.any(Function));
    expect(CoinSelectionError).toEqual(expect.any(Function));
    expect(types.CardanoAddressType).toEqual(expect.any(Object));
    expect(types.CardanoDRepType).toEqual(expect.any(Object));
    expect(trezorUtils).toMatchObject({
      drepIdToHex: expect.any(Function),
      signTransaction: expect.any(Function),
      transformToTokenBundle: expect.any(Function),
      transformToTrezorInputs: expect.any(Function),
      transformToTrezorOutputs: expect.any(Function),
    });
  });
});
