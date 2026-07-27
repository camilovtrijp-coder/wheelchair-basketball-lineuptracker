const fs = require('fs');
const { spawnSync } = require('child_process');
const out = fs.openSync('test-out.log', 'w');
const err = fs.openSync('test-err.log', 'w');
const result = spawnSync('node', ['node_modules/@playwright/test/cli.js', 'test'], { stdio: ['ignore', out, err] });
fs.writeFileSync('test-status.txt', result.status.toString());
