const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const engine = require('../package.json');

const installArguments = ['install', ...(engine.private ? ['--offline'] : []), '--no-audit', '--no-fund'];
const installCommand = `npm ${installArguments.join(' ')}`;

async function installDependencies(destination, { signal, env = process.env } = {}) {
  signal?.throwIfAborted();
  const directories = [path.dirname(process.execPath), ...(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)];
  const npmPath = env.npm_execpath || directories
    .map((directory) => path.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    .find((candidate) => fs.existsSync(candidate));
  if (!npmPath && process.platform === 'win32') {
    throw new Error('Cannot locate npm. Run setup through "npm run setup" with Node.js and npm installed.');
  }
  const command = npmPath ? process.execPath : 'npm';
  const args = npmPath ? [npmPath, ...installArguments] : installArguments;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: destination, env, signal, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let details = '';
    let failure;
    const capture = (chunk) => { details = (details + chunk.toString()).slice(-8192); };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', (error) => { failure = error; });
    // Wait for close even on cancellation so installation cannot outlive setup.
    child.on('close', (code, exitSignal) => {
      if (signal?.aborted) reject(signal.reason);
      else if (failure || code !== 0) {
        reject(new Error(`Dependency installation failed (${failure?.message || exitSignal || `exit ${code}`}).` +
          (details.trim() ? `\n${details.trim()}` : '')));
      } else resolve(details.trim());
    });
  });
}

module.exports = { installDependencies, installCommand };
