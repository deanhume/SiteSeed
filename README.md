# SiteSeed

A small Markdown-powered blogging engine. Write posts in files, keep images
beside them, and import content from an existing website without needing Ghost.

**Pre-release:** setup works from this checkout; the npm package is not
published yet. By default, your blog lives right here in the checkout.

## Quick start

Install **Node.js 20.9.0 or newer**. Clone or download this repository, open a
terminal in its folder, and run:

```powershell
npm ci
npm run setup
```

The wizard uses **the current directory**. It asks for your blog name,
author details, description, and optional website URL, then writes posts to
`content\posts` in this folder. Choose:

- **Starter content:** a published welcome post, an About page, and an example draft.
- **Website import:** discover articles from a website or sitemap.
- **Ghost export:** import from a local export file, without a live sitemap.

For imports, setup **publishes all successfully extracted content in your new blog**,
including possible archive pages. There are no per-draft questions: confirm
the final summary, then review or delete content locally before deploying.
This includes drafts and scheduled posts from the source. Set `draft: true`
in an imported file if you want to hide it again.

Missing metadata uses flagged placeholders. Missing, invalid, or future
publication dates use the import time, not a guessed original date. Check
`import_notes` in each affected Markdown file and `content\import-report-*.json`
for adjustments and their original values before deploying.

Confirm the summary. Setup shows progress while creating content, building
assets, and **installing dependencies for you**. Wait for **Setup complete!**
and the count of posts and pages created. It does not start a server or deploy
anything online.

Next, start the blog from the **same terminal and directory**:

```powershell
npm run dev
```

Open `http://localhost:3000` (or the address printed by the server).
Keep the terminal open; press Ctrl+C to stop. Imported posts appear on the
homepage; imported pages have their own URLs and are not in the post list.
Setup prints an example URL as well as any import failures.

Pre-release setup installs dependencies offline. If installation fails,
your blog files are kept: follow the printed retry command rather than
rerunning setup.

**Existing content is protected.** In a fresh checkout, setup keeps the engine,
package files, theme assets and unrelated files. Existing settings are used as
prompt defaults; settings not covered by the wizard are retained. After you
confirm, it updates the configuration and empty generated indexes. It refuses
to replace existing posts, pages or other content.

Type `cancel` at a prompt or press Ctrl+C to cancel. To deliberately use a
separate, empty folder instead, run
`node bin\siteseed.js create "C:\blogs\my-blog"` or
`node bin\siteseed.js setup --root "C:\blogs\my-blog"`.
That separate pre-release project links to this engine, which must stay available.

Run the remaining commands from your **blog directory**. Change settings in
`siteseed.config.json` and restart after configuration changes.

## Write your first post

With starter content, begin by editing `content\posts\example-draft\index.md`
and opening `http://localhost:3000/preview/example-draft/`.
To add another post, create `content\posts\hello-world\index.md`:

```markdown
---
title: Hello world
slug: hello-world
description: My first post on SiteSeed.
date: 2026-09-30
updated: 2026-09-30
author: Your Name
tags: ["Writing"]
tag_slugs: ["writing"]
draft: true
---

Welcome to my blog!
```

Replace the example dates and author with your own. Publication dates cannot
be in the future; the folder name and `slug` must match.

Preview at `http://localhost:3000/preview/hello-world/`. When ready, change
`draft: true` to `draft: false` and run:

```powershell
npm run check
```

Your post is now available locally at `http://localhost:3000/hello-world/`.
This command validates the blog; it does not deploy it.

**Drafts are not private.** Preview URLs work without authentication, including
in production. Review drafts locally and do not store confidential content.

### Images and pages

Keep images in the same folder as `index.md`, then use `![Description](photo.jpg)`.
For a cover image, add these fields inside the front matter:

```yaml
feature_image: photo.jpg
feature_image_alt: A description of the photo.
```

Create pages the same way under `content\pages\<slug>\index.md`. Add their
links to `navigation` in `siteseed.config.json`.

Markdown supports headings, lists, links, images, code, quotes, and tables.
Raw HTML is escaped by default. Only use `allow_html: true` for trusted
content you control: it also permits scripts.

## Import an existing website

The setup wizard publishes imported content in a new blog. For **additional
imports into an existing blog**, the commands below keep content as drafts
and retain manual selection and metadata review rather than supplying
placeholders. Ghost is not required.
Only import content you own or have permission to migrate.

### 1. Create a preview

```powershell
npm run import:website -- --source https://old.example/sitemap.xml --output import-preview.json
```

This discovers pages and extracts their content without writing blog posts
or downloading media.

### 2. Review it

Open `import-preview.json` in your editor:

- Set `selected` to `false` for pages you do not want.
- Check titles, dates, slugs, author, Markdown, and media URLs.
- Use `collection: "pages"` for pages; website entries default to `"posts"`.
- Supply missing publication dates and read the `warnings` and `failures`.
  A sitemap's modification date is not a publication date.

### 3. Import as drafts

```powershell
npm run import:website -- --apply import-preview.json
```

SiteSeed downloads supported media, writes drafts, and rebuilds images and
search. Review each draft at `/preview/<slug>/`, then publish it by changing
`draft` to `false` and running `npm run check`.

**Existing content and settings are never overwritten.** Conflicting slugs
and missing or invalid dates block import. Existing preview files are also
protected; choose a new filename to create another preview.

Check `content\import-report-*.json` for URL mappings and failures. A command
can exit with an error after creating useful drafts if some media failed:
inspect the report before retrying. Failed downloads remain remote; failed
cover images are omitted.

Import reads static HTML, not JavaScript-rendered or logged-in pages.
Extraction needs review, and old-site redirects are not created. HTML/SVG
media downloads and Ghost records without HTML bodies are unsupported.

### Optional: import a Ghost export

```powershell
npm run import:ghost -- --source https://old.example --export ghost-backup.json --output ghost-preview.json
```

Review `ghost-preview.json` using the same steps above, then run:

```powershell
npm run import:ghost -- --apply ghost-preview.json
```

Ghost preview needs no live sitemap. Media must still be reachable when
applying. Site settings, author profiles, and tag artwork are not imported.
These standalone commands keep imported content as drafts, including previously
published posts. The setup wizard instead publishes everything after confirmation.

## Everyday commands

| Command | Use |
| --- | --- |
| `npm run setup` | Start setup from the engine checkout; existing blog folders are protected. |
| `npm run dev` | Build once and start the local development server. |
| `npm run build` | Refresh generated images and search after content changes. |
| `npm run check` | Build and validate your blog before publishing. The engine checkout also runs tests. |
| `npm start` | Refresh search and start the server. |
| `npm run import:website -- --help` | Show import options. |

Markdown edits appear on refresh in development. Image/search generation does
not watch for changes, so rerun `npm run build` when needed.

Engine CLI commands support `--root <blog-directory>`. Import file paths
resolve from your terminal's current directory.

## Deploy

Use any host that supports Node.js 20.9.0+ and an Express server. Set your
public origin and start in production mode. For example, in PowerShell:

```powershell
npm ci
npm run check
$env:NODE_ENV = "production"
$env:SITE_URL = "https://example.com"
npm start
```

For the default in-place setup, deploy this project with its engine files,
configuration and content. If you explicitly created a separate pre-release
project, it has a local `file:` dependency: the host must also have the engine
at the referenced path with its dependencies installed.

Deploy your configuration, content, public assets, and installed dependencies.
The host can set `PORT`; the default is `3000`. The `public` directory must
be writable because startup refreshes search. Restart after deploying changes.

RSS, sitemaps, and robots metadata are generated automatically. Analytics is
off unless you set your own `GA4_MEASUREMENT_ID`.

See `plan.md` for production draft restrictions, licensing, and release work
still to come.
