import * as utils from '../../../src/utils/trezor/transformations';
import * as fixtures from './fixtures/transformations';
import { FinalOutput } from '../../../src/types/types';

describe('trezor transformation utils', () => {
  fixtures.transformToTrezorInputs.forEach(f => {
    test(f.description, () => {
      expect(utils.transformToTrezorInputs(f.utxos, f.trezorUtxos)).toEqual(
        f.result,
      );
    });
  });

  fixtures.transformToTrezorInputsExceptions.forEach(f => {
    test(f.description, () => {
      expect(() =>
        utils.transformToTrezorInputs(f.utxos, f.trezorUtxos),
      ).toThrow(f.error);
    });
  });

  fixtures.transformToTrezorOutputs.forEach(f => {
    test(f.description, () => {
      expect(
        utils.transformToTrezorOutputs(
          f.outputs as FinalOutput[],
          f.changeAddressParameters,
        ),
      ).toMatchObject(f.result);
    });
  });

  fixtures.drepIdToHex.forEach(f => {
    test(f.description, () => {
      expect(utils.drepIdToHex(f.drepId)).toStrictEqual(f.result);
    });
  });
});
