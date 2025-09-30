const { spawn } = require('child_process');
const path = require('path');

function run() {
  const electronPath = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env,
    cwd: path.resolve(__dirname, '..'),
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code || 0);
    }
  });
}

run();
