import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// npm runs prepare before prepack for pack/publish. prepack always performs a
// clean build, so avoid doing the same work twice in those lifecycles. prepare
// still builds Git installs, where prepack is not run.
if (process.env.npm_command === 'pack' || process.env.npm_command === 'publish') {
  process.exit(0);
}

if (!existsSync('lib/cjs/index.js') || !existsSync('lib/esm/index.js')) {
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
}
