const { spawnSync } = require('child_process');
const result = spawnSync('node', ['node_modules/@playwright/test/cli.js', 'test'], { stdio: 'inherit' });
process.exit(result.status);
