const fs = require('node:fs/promises');
const path = require('node:path');

async function statOrNull(target) {
  try { return await fs.lstat(target); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

const sameFile = (a, b) => a?.ino === b?.ino && a?.dev === b?.dev;

async function replaceContents(handle, data) {
  let offset = 0;
  while (offset < data.length) {
    const { bytesWritten } = await handle.write(data, offset, data.length - offset, offset);
    if (!bytesWritten) throw new Error('Could not finish writing setup file.');
    offset += bytesWritten;
  }
  await handle.truncate(data.length);
}

async function inspectCheckout(destination) {
  const directories = new Map();
  for (const relative of ['', 'content', 'public']) {
    const target = path.join(destination, relative);
    const stat = await statOrNull(target);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
      throw new Error(`Setup needs an ordinary directory, not a link: ${target}`);
    }
    if (stat) directories.set(relative, stat);
  }
  if (!directories.has('')) throw new Error(`Checkout no longer exists: ${destination}`);
  if (directories.has('content')) {
    for (const entry of await fs.readdir(path.join(destination, 'content'))) {
      if (entry === 'image-manifest.json') continue;
      const relative = path.join('content', entry);
      const target = path.join(destination, relative);
      const stat = await fs.lstat(target);
      if (!['posts', 'pages', 'tags', 'authors'].includes(entry) ||
          !stat.isDirectory() || stat.isSymbolicLink() || (await fs.readdir(target)).length) {
        throw new Error(`Blog content already exists at ${target}. Setup will not overwrite it. Use the import commands to add content to an existing blog.`);
      }
      directories.set(relative, stat);
    }
  }
  const files = new Map();
  for (const relative of ['siteseed.config.json', path.join('content', 'image-manifest.json'), path.join('public', 'search-index.json')]) {
    const target = path.join(destination, relative);
    const stat = await statOrNull(target);
    if (!stat) continue;
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Setup cannot replace a linked or non-file path: ${target}`);
    const data = await fs.readFile(target);
    const value = JSON.parse(data.toString('utf8').replace(/^\uFEFF/, ''));
    if (relative !== 'siteseed.config.json') {
      const empty = relative.endsWith('search-index.json')
        ? Array.isArray(value) && value.length === 0
        : value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).length === 0;
      if (!empty) throw new Error(`Generated content already exists at ${target}. Setup will not overwrite it.`);
    }
    files.set(relative, { data, stat });
  }
  return { directories, files };
}

async function publishCheckout(staging, destination, initial, signal) {
  signal.throwIfAborted();
  const current = await inspectCheckout(destination);
  if (initial.directories.size !== current.directories.size || initial.files.size !== current.files.size ||
      [...initial.directories].some(([name, stat]) => !sameFile(stat, current.directories.get(name))) ||
      [...initial.files].some(([name, file]) => !sameFile(file.stat, current.files.get(name)?.stat) ||
        !file.data.equals(current.files.get(name).data))) {
    throw new Error('Checkout changed during setup. No blog files were written; rerun setup.');
  }
  const directories = [];
  const files = [];
  async function collect(relative = '') {
    for (const entry of await fs.readdir(path.join(staging, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        directories.push(name);
        await collect(name);
      } else files.push(name);
    }
  }
  await collect();
  for (const name of [...directories, ...files]) {
    const stat = await statOrNull(path.join(destination, name));
    if (stat && !current.directories.has(name) && !current.files.has(name)) {
      throw new Error(`Setup destination already exists: ${path.join(destination, name)}`);
    }
  }
  const created = [];
  const opened = [];
  const knownDirectories = new Map(current.directories);
  async function checkParents(name) {
    for (let parent = path.dirname(name); ; parent = path.dirname(parent)) {
      const relative = parent === '.' ? '' : parent;
      const stat = await statOrNull(path.join(destination, relative));
      if (!stat?.isDirectory() || stat.isSymbolicLink() || !sameFile(stat, knownDirectories.get(relative))) {
        throw new Error(`Directory changed during setup: ${path.join(destination, relative)}`);
      }
      if (!relative) break;
    }
  }
  try {
    for (const name of directories) {
      signal.throwIfAborted();
      await checkParents(name);
      if (!current.directories.has(name)) {
        const target = path.join(destination, name);
        await fs.mkdir(target);
        created.push(target);
        knownDirectories.set(name, await fs.lstat(target));
      }
    }
    for (const name of files) {
      signal.throwIfAborted();
      await checkParents(name);
      const target = path.join(destination, name);
      const original = current.files.get(name);
      const stat = await statOrNull(target);
      if (original && (stat?.isSymbolicLink() || !sameFile(original.stat, stat))) {
        throw new Error(`File changed during setup: ${target}`);
      }
      const handle = await fs.open(target, original ? 'r+' : 'wx');
      if (original) {
        try {
          if (!sameFile(original.stat, await handle.stat()) || !original.data.equals(await handle.readFile())) {
            throw new Error(`File changed during setup: ${target}`);
          }
        } catch (error) {
          await handle.close();
          throw error;
        }
      }
      const saved = { target, handle, original };
      opened.push(saved);
      const data = await fs.readFile(path.join(staging, name));
      await replaceContents(handle, data);
      if (!original) {
        await handle.close();
        saved.handle = null;
      }
    }
    signal.throwIfAborted();
  } catch (error) {
    const failures = [];
    for (const { target, handle, original } of opened.reverse()) {
      try {
        if (original) {
          await replaceContents(handle, original.data);
        }
      } catch (failure) { failures.push(failure); }
      try { await handle?.close(); } catch (failure) { failures.push(failure); }
      if (!original) {
        try { await fs.unlink(target); } catch (failure) { failures.push(failure); }
      }
    }
    for (const target of created.reverse()) {
      try { await fs.rmdir(target); } catch (failure) { failures.push(failure); }
    }
    if (failures.length) {
      throw new AggregateError([error, ...failures],
        `Setup failed and could not fully restore the checkout. Check the saved files before retrying.\n${[error, ...failures].map((failure) => failure.message).join('\n')}`);
    }
    throw error;
  }
  for (const { handle } of opened) await handle?.close();
}

module.exports = { inspectCheckout, publishCheckout };
