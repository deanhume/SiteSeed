const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { validateContent } = require('../src/content-validator');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'siteseed-validator-'));
  const postDirectory = path.join(root, 'content', 'posts', 'example');
  fs.mkdirSync(postDirectory, { recursive: true });
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'siteseed.config.json'), JSON.stringify({
    title: 'Example blog',
    description: 'An independent blog.',
    author: { name: 'Example Author', slug: 'example' },
  }));
  fs.writeFileSync(path.join(postDirectory, 'hero.jpg'), 'image');
  fs.writeFileSync(
    path.join(postDirectory, 'index.md'),
    `---
title: "Example"
slug: "example"
description: "A useful description for an example article that is long enough."
date: "2026-09-14"
updated: "2026-09-14"
tags: ["Testing"]
tag_slugs: ["testing"]
feature_image: "hero.jpg"
feature_image_alt: "Example cover"
draft: false
---

An article with ![useful alt text](hero.jpg).
`,
  );
  fs.writeFileSync(
    path.join(root, 'public', 'search-index.json'),
    JSON.stringify([{ slug: 'example' }]),
  );
  return { root, postDirectory };
}

test('accepts a complete post with local media', () => {
  const { root } = fixture();
  const issues = validateContent(root, { now: new Date('2026-09-15') });

  assert.deepEqual(
    issues.filter(({ severity }) => severity === 'error'),
    [],
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('reports publishing errors in a post', () => {
  const { root, postDirectory } = fixture();
  const filePath = path.join(postDirectory, 'index.md');
  const source = fs
    .readFileSync(filePath, 'utf8')
    .replace('slug: "example"', 'slug: "different"')
    .replace('date: "2026-09-14"', 'date: "2026-09-16"')
    .replace('![useful alt text](hero.jpg)', '![](missing.jpg)');
  fs.writeFileSync(filePath, source);

  const issues = validateContent(root, { now: new Date('2026-09-15') });
  const messages = issues.map(({ message }) => message);

  assert(messages.some((message) => message.includes('does not match folder')));
  assert(messages.some((message) => message.includes('Publication date is in the future')));
  assert(messages.some((message) => message.includes('Missing local asset')));
  assert(messages.some((message) => message.includes('Image has no alt text')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('rejects a feature image outside its post folder', () => {
  const { root, postDirectory } = fixture();
  const filePath = path.join(postDirectory, 'index.md');
  const source = fs
    .readFileSync(filePath, 'utf8')
    .replace('feature_image: "hero.jpg"', 'feature_image: "../outside.jpg"');
  fs.writeFileSync(filePath, source);
  fs.writeFileSync(path.join(postDirectory, '..', 'outside.jpg'), 'image');

  const issues = validateContent(root, { now: new Date('2026-09-15') });

  assert(
    issues.some(({ message }) =>
      message.includes('feature_image must stay inside the post folder'),
    ),
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('requires allow_html to be a boolean', () => {
  const { root, postDirectory } = fixture();
  const filePath = path.join(postDirectory, 'index.md');
  const source = fs
    .readFileSync(filePath, 'utf8')
    .replace('draft: false', 'allow_html: yes\ndraft: false');
  fs.writeFileSync(filePath, source);

  const issues = validateContent(root, { now: new Date('2026-09-15') });

  assert(
    issues.some(({ message }) =>
      message.includes('allow_html must be true or false'),
    ),
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('validates bookmark thumbnails and icons as local article assets', () => {
  const { root, postDirectory } = fixture();
  const filename = path.join(postDirectory, 'index.md');
  fs.appendFileSync(filename, '\n```bookmark\n' + JSON.stringify({
    url: '/water/',
    title: 'Water',
    thumbnail: 'missing.jpg',
    icon: '../outside.ico',
  }) + '\n```\n');
  const issues = validateContent(root, { now: new Date('2026-09-15') });
  assert(issues.some(({ message }) => message === 'Missing local asset: missing.jpg'));
  assert(issues.some(({ message }) => message === 'Local asset escapes its post folder: ../outside.ico'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('reports malformed bookmark metadata with the source file', () => {
  const { root, postDirectory } = fixture();
  fs.appendFileSync(path.join(postDirectory, 'index.md'), '\n```bookmark\nnot json\n```\n');
  const issues = validateContent(root, { now: new Date('2026-09-15') });
  assert(issues.some(({ message, filePath }) =>
    /Invalid bookmark JSON/.test(message) && filePath.endsWith('index.md'),
  ));
  fs.rmSync(root, { recursive: true, force: true });
});
