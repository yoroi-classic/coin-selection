import fs from 'fs';
import path from 'path';

describe('Cardano runtime dependencies', () => {
  const root = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  );
  const lockfile = fs.readFileSync(path.join(root, 'yarn.lock'), 'utf8');

  test('uses exact CML Node.js and browser packages', () => {
    expect(packageJson.dependencies).toMatchObject({
      '@dcspark/cardano-multiplatform-lib-browser': '6.2.0',
      '@dcspark/cardano-multiplatform-lib-nodejs': '6.2.0',
    });
    expect(packageJson.browser).toEqual({
      '@dcspark/cardano-multiplatform-lib-nodejs':
        '@dcspark/cardano-multiplatform-lib-browser',
    });
  });

  test('does not resolve Cardano Serialization Lib', () => {
    expect(JSON.stringify(packageJson)).not.toContain(
      '@emurgo/cardano-serialization-lib',
    );
    expect(lockfile).not.toContain('@emurgo/cardano-serialization-lib');
  });
});
