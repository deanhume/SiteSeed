const readline = require('node:readline');

class SetupCancelled extends Error {
  constructor(message = 'Setup cancelled.', exitCode = 0) {
    super(message);
    this.exitCode = exitCode;
  }
}

function createPrompts(input = process.stdin, output = process.stdout) {
  const controller = new AbortController();
  const lines = [];
  let pending;
  let closed = false;
  const rl = readline.createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
  const display = (text) => String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
  const write = (text) => output.write(`${display(text)}\n`);
  const interrupt = () => {
    controller.abort(new SetupCancelled('Setup cancelled (Ctrl+C).', 130));
    rl.close();
  };
  rl.on('line', (line) => {
    if (pending) {
      const { resolve } = pending;
      pending = null;
      resolve(line);
    } else lines.push(line);
  });
  rl.on('close', () => {
    closed = true;
    if (pending) {
      const { reject } = pending;
      pending = null;
      reject(controller.signal.reason || new SetupCancelled('Setup cancelled: input ended.', 1));
    }
  });
  rl.on('SIGINT', interrupt);
  process.on('SIGINT', interrupt);

  async function ask(label, { defaultValue = '', validate = () => '' } = {}) {
    while (true) {
      controller.signal.throwIfAborted();
      output.write(`${display(label)}${defaultValue ? ` [${display(defaultValue)}]` : ''}: `);
      const line = lines.length ? lines.shift() : closed
        ? (() => { throw new SetupCancelled('Setup cancelled: input ended.', 1); })()
        : await new Promise((resolve, reject) => { pending = { resolve, reject }; });
      if (line.trim().toLowerCase() === 'cancel') throw new SetupCancelled();
      const value = line.trim() || defaultValue;
      const error = await validate(value);
      if (!error) return value;
      write(error);
    }
  }

  async function confirm(label, defaultValue = false) {
    return /^(?:y|yes)$/i.test(await ask(`${label} (yes/no)`, {
      defaultValue: defaultValue ? 'yes' : 'no',
      validate: (value) => /^(?:y|yes|n|no)$/i.test(value) ? '' : 'Enter yes or no.',
    }));
  }

  async function progress(label, action) {
    const animated = Boolean(output.isTTY);
    const frames = ['|', '/', '-', '\\'];
    let frame = 0;
    const clear = () => { if (animated) output.write('\r\x1b[2K'); };
    const draw = () => output.write(`\r${frames[frame++ % frames.length]} ${display(label)}`);
    if (animated) draw();
    else write(`[working] ${label}`);
    const timer = animated ? setInterval(draw, 100) : null;
    const log = (message) => {
      clear();
      write(message);
      if (animated) draw();
    };
    let status = 'done';
    try {
      controller.signal.throwIfAborted();
      return await action(log);
    } catch (error) {
      status = controller.signal.aborted || error instanceof SetupCancelled ? 'cancelled' : 'failed';
      throw error;
    } finally {
      if (timer) clearInterval(timer);
      clear();
      write(`[${status}] ${label}`);
    }
  }

  return {
    ask, confirm, write, progress, signal: controller.signal,
    close() {
      process.removeListener('SIGINT', interrupt);
      rl.close();
    },
  };
}

module.exports = { createPrompts, SetupCancelled };
