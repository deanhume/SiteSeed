const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const manifest = require('../package.json');
const lock = require('../package-lock.json');

test('package and lockfile agree on identity, dependencies, CLI and Node requirement', () => {
  assert.equal(manifest.name, 'siteseed');
  assert.equal(manifest.type, 'commonjs');
  assert.equal(manifest.scripts.setup, 'node bin/siteseed.js setup');
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].name, manifest.name);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  assert.deepEqual(lock.packages[''].bin, manifest.bin);
  assert.deepEqual(lock.packages[''].engines, manifest.engines);
  assert.equal(manifest.engines.node, lock.packages['node_modules/sharp'].engines.node);
  assert.equal(typeof require('../app').createApp, 'function');
  for (const entry of [manifest.main, ...Object.values(manifest.bin)]) {
    assert(fs.statSync(path.join(root, entry)).isFile(), entry);
  }
  const cli = fs.readFileSync(path.join(root, manifest.bin.siteseed), 'utf8');
  assert(cli.startsWith('#!/usr/bin/env node\n'));
});

test('lockfile uses portable package URLs and retains integrity verification', () => {
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name) continue;
    assert(entry.resolved, `Missing resolved URL: ${name}`);
    assert.equal(new URL(entry.resolved).origin, 'https://registry.npmjs.org', name);
    assert.match(entry.integrity, /^sha(?:1|256|384|512)-/, name);
  }
});

test('distribution keeps blog-owned and development files outside the package allowlist', () => {
  for (const entry of manifest.files) {
    assert(!/^(?:content|test|\.github)(?:\/|$)/.test(entry), entry);
    assert(!/config\.json|search-index|robots\.txt/.test(entry), entry);
    assert.notEqual(entry, 'public/');
  }
  assert(manifest.dependencies.sharp, 'Installed build command needs sharp.');
  assert(manifest.dependencies.turndown, 'Installed import command needs turndown.');
  assert(manifest.dependencies.sax, 'Installed website import needs XML parsing.');
  assert(manifest.dependencies['@mixmark-io/domino'], 'Installed website import needs HTML parsing.');
});
