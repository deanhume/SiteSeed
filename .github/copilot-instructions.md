# SiteSeed contributor instructions

SiteSeed is a Markdown-first blogging engine, not a particular author's blog.
Follow `plan.md` for remaining work. Keep site identity and content in each
blog's configuration and files; never add personal domains, author aliases,
analytics IDs, or cloud deployment targets to the engine.

## Commands

Requires Node.js 20.9.0 or newer.

```powershell
npm ci
npm run dev
npm run check
```

- Use `npm ci` for a lockfile-based install and `npm install` only when changing dependencies.
- `npm run setup` creates the blog in the current directory by default, including a fresh source checkout. No name-derived folder or folder prompt. Explicit `create <directory>` and `setup --root <directory>` still support separate empty destinations.
- Setup installs dependencies automatically, then prints `npm run dev`; print `cd` only when the destination differs from cwd. It does not launch a server or deploy. Separate pre-release projects use a local `file:` engine dependency; in-place checkout setup keeps the existing package without creating a self-dependency. Both use offline installation while pre-release.
- Generated blog projects expose `npm run check` for build/content validation. The engine checkout's `npm run check` additionally runs the test suite.
- `npm start` refreshes search and starts Express on `PORT` or port 3000.
- `npm run dev` builds once, then starts Node's code watcher. It does not rebuild image or search artifacts when content changes.
- `npm run build` invokes both generators; `build:images` and `build:search` run targeted builds.
- `npm run check` builds, validates content, and runs all tests. There is no separate lint command; also run `git diff --check`.
- `npm run check:content` builds and validates without running the test suite.
- `npm run import:website -- --source <url> --output <preview.json>` previews a website/sitemap without writing content. Review the JSON, then use `--apply <preview.json>` to write drafts and rebuild.
- `npm run import:ghost -- --source <old-url> --export <export.json> --output <preview.json>` is the optional export-only adapter to the same preview/apply workflow.
- Import never overwrites existing content or configuration. Standalone preview/apply requires valid dates and writes drafts. Setup supplies explicit placeholders and unique slugs, then publishes all extracted items after confirmation. Recorded failures exit nonzero; media failures can leave imported content with remote media and a durable report.
- Runtime/import commands accept `--root <blog-directory>` with precedence over `SITESEED_ROOT`, then cwd. Setup uses an explicit create/root argument or cwd, not `SITESEED_ROOT`. Existing content blocks setup; use import commands to add to an established blog.

Run one test file or named test:

```powershell
node --test test\content.test.js
node --test --test-name-pattern="escapes Markdown URLs" test\content.test.js
```

## Engine and blog boundaries

- `app.js` exports `createApp({ rootDirectory, env })`, returning an Express app without listening. Main-module and CLI entry points open the listener.
- `src\site.js` validates root-level `siteseed.config.json` and creates per-blog paths and settings. Requiring an engine module must not read configuration or start a server.
- Blog-owned files live under its `content` and `public` directories. Never resolve user content relative to the installed engine or write generated files into it.
- `src\templates.js` exports `createTemplates(blog)`. Template and asset caches belong to the instance, not a module singleton.
- Blog public files override the allowlisted bundled theme assets. Do not fall back to bundled content, search data, or branding.
- `src\content.js` parses front matter, filters drafts, sorts posts, merges tag metadata, resolves image variants, and invokes the renderer. Pass the configured author as `defaultAuthor`.
- `src\markdown.js` is a small in-house renderer. Preserve protected fragments, escaping, asset rewriting, and heading metadata.
- `src\rss.js` receives site settings explicitly and renders the newest 15 posts with absolute URLs and executable blocks removed.
- Image builds create 640px/1280px WebP variants and `content\image-manifest.json`. Search builds write `public\search-index.json`, strip executable/code blocks, and limit searchable body text to 1,500 characters.
- The image builder processes feature/card images and local tag artwork, not ordinary inline images. Stale-file cleanup must remain confined to recorded variants inside the selected content directory.
- Importer code is loaded for import/setup commands only. Normal server startup does not load `sharp` or `turndown`.
- `src\import-source.js` handles bounded sitemap discovery and static HTML extraction. `src\import-markdown.js` shares table/bookmark conversion. `src\import-write.js` stages, validates and writes drafts by default; only setup explicitly opts into published output. It localizes supported media and records URL mappings/failures. `scripts\import-site.js` owns preview/apply CLI arguments; the Ghost adapter reads export records without requiring a live sitemap.
- Source URLs are independent of the destination origin. Do not infer publication dates from sitemap lastmod, run imported scripts, enable trusted HTML, restore automatic archive-service requests, or silently overwrite settings/content.
- `scripts\setup.js` owns setup/create orchestration with one final confirmation. `src\setup-prompts.js` handles queued input, validation, EOF, cancellation and TTY-aware progress; `src\setup-content.js` generates starter content, blog package scripts and bulk-import metadata. Stage and validate before publishing to an empty destination or eligible checkout; recheck conflicts before writing.
- `src\setup-checkout.js` handles the in-place source-checkout exception. Preserve engine/package/theme/unrelated files, use current configuration as prompt defaults, and retain unprompted settings. Replace only the confirmed config and empty image/search indexes. Refuse existing content and links, recheck original snapshots, and roll back owned writes on failure. Never configure a package inside `node_modules` in place.
- `src\setup-install.js` runs npm in the final blog directory after its manifest is written. Await child termination on cancellation. Preserve saved content on install failure and print recovery instructions, never a success message or "no files written".
- Setup publishes all successfully extracted items, including possible archives and source drafts/scheduled posts. The confirmation must state this before writing. Flag metadata placeholders in Markdown `import_notes` and report adjustments with original/replacement values. Use import time only as an explicit placeholder for missing/invalid/future publication dates; preserve valid source dates. Standalone manual imports do not silently gain this behavior.
- Completion must show actual post/page counts, distinguish import errors from clean success, and finish with start commands and the local URL. Pages do not appear in the homepage post list. No server is running until the user starts it.
- Ctrl+C must abort import network requests, not turn cancellation into a partial-import success. Never delete or overwrite a pre-existing blog when setup fails or is rerun.

## Content conventions

- Posts use `content\posts\<slug>\index.md`; pages use `content\pages\<slug>\index.md`. Folder name, front-matter slug, and public root route must match.
- Media stays beside its article. Do not move article media into the shared public directory.
- Front matter supports scalars, booleans, and JSON-style arrays, not general YAML.
- Retain the documented metadata shape: title, slug, description, date, updated, author, parallel tags/tag_slugs arrays, optional image fields, and boolean draft.
- Publication dates cannot be in the future. `date` controls ordering; `updated` controls modification metadata.
- Feature/card image paths must stay inside the article folder. Include alt text.
- Use supported Markdown constructs. Raw HTML is escaped unless a trusted article explicitly sets `allow_html: true`.
- Tables use pipe Markdown with delimiter rows. Preserve row/column relationships, alignment, escaped pipes, and safe `<br>` breaks.
- Ghost HTML tables must convert without flattening cells. Unsupported nested/merged tables or inconsistent widths must fail explicitly.
- Bookmark cards use fenced `bookmark` JSON, with required url/title and optional description, author, publisher, icon, thumbnail, and caption. Escape metadata, reject unsafe URLs, preserve local media, and do not fetch runtime metadata.
- Drafts stay out of public listings, search, RSS, and sitemaps. Current preview routes are unauthenticated; their HTML/assets must retain private/no-store and noindex/nofollow headers. Production preview access restrictions remain planned.
- Draft posts and pages share `/preview/<slug>/`; their assets use separate `/preview-assets/posts/` and `/preview-assets/pages/` roots. Published asset routes must check collection membership and refuse Markdown source.
- Level 2-4 headings receive stable unique IDs; at least two headings produce article navigation.
- Tag metadata lives in `content\tags\<slug>\index.json`; article front matter supplies membership.
- Rebuild generated artifacts after content/image changes and review legitimate output changes.
- The distributed checkout starts without posts/pages. Setup writes the user's blog there by default; explicit separate-project setup remains available. Tests must use disposable content and checkout copies, never configure the working checkout or require its original branding/content.

## Runtime and rendering

- Use CommonJS and the built-in `node:test` runner.
- In production, each app has immutable content snapshots and caches deterministic HTML by route. Restart/deployment invalidates them. Development rereads content and rerenders.
- Never share cached output that depends on request headers, cookies, authentication, query parameters, or visitor-specific state without an appropriate cache key.
- Register fixed routes before the final `/:slug/` route.
- Escape metadata through template helpers. Preserve the distinction between author and site/publisher.
- Use configured branding and navigation in headers, footers, RSS, and structured data. Missing logos/social images must be supported.
- The homepage shows five posts and links to the configured author's archive. Empty content collections must work.
- All published pages use their root slugs and are included in the page sitemap; do not reserve historical utility-page slugs.
- Robots, canonical, RSS, and sitemap URLs use one configured origin. `SITE_URL` overrides `url`; the default is `http://localhost:3000`.
- Public routes use trailing slashes; redirects preserve queries. Do not add site-specific historical redirects.
- Analytics is off unless a syntactically valid `GA4_MEASUREMENT_ID` is supplied. Keep loader and initialization together; no hardcoded IDs or per-owner restrictions.
- Keep browser behavior dependency-free. Preserve high-priority feature images, lazy secondary images, deterministic placeholders, responsive navigation, and accessible table scrolling.
- Keep deployment provider-neutral. Do not commit personal cloud targets, credentials, or export files.
- Package contents are allowlisted. Build/import libraries must remain available to installed engine users; do not move them to development-only dependencies without changing the CLI contract.
- Keep the lockfile portable with public registry URLs. Publication remains blocked by `private: true` until license and release decisions are made.

## Tests

- `test\app.test.js` creates a temporary blog and exercises real HTTP routes, caches, compression, tables, bookmarks, media, drafts, feeds, sitemaps, redirects, errors, and empty content.
- `test\fixtures\blog\siteseed.config.json` supplies a neutral test identity. Never depend on the checkout's personal settings.
- `test\blog.test.js` covers configuration, external blog directories, assets, root precedence, output isolation, and CLI failures.
- `test\content.test.js` covers front matter, escaping, tables, bookmarks, headings, media rewriting, and loading.
- `test\content-validator.test.js` uses temporary content trees to verify publishing failures.
- `test\templates.test.js` checks rendered markup, metadata, optional branding, navigation, and analytics.
- `test\rss.test.js` checks sanitization and serialization.
- `test\import-ghost.test.js` checks conversion helpers without crawling live sites.
- `test\import-site.test.js` uses controlled local HTTP sources and temporary blogs for sitemaps, extraction, draft/media HTTP behavior, optional Ghost exports, failure reports, conflicts, and the actual CLI.
- `test\setup.test.js` exercises starter/bulk-import setup, in-place checkout imports and file/settings preservation, rollback/conflicts, publication across HTTP/search/RSS/sitemaps, placeholder metadata, progress, cancellation, and real automatic offline installation.
- Update HTTP integration assertions when changing routes, metadata, shared layout, or generated assets; helper-only tests are not sufficient.
