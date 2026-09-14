import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

if (!existsSync('lib/cjs/index.js') || !existsSync('lib/esm/index.js')) {
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
}
