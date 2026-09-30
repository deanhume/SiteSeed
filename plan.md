# SiteSeed implementation plan

Recorded: September 30, 2026.

Status: Phase 1 implemented. The original content and site identity have been
removed, and tests now use neutral fixtures. Setup now configures the current directory
with starter content or published bulk imports, progress indicators and
automatic dependency installation. Production draft restrictions and
release work remain. Website import has a preview/review/apply workflow;
Ghost exports are an optional input to the same draft writer.

This is the working plan for turning the original single-site application into
SiteSeed, a simple, open-source blogging engine. It supersedes
`open-source-blogging-tool-plan.md` where the proposals differ, particularly
around distributing the engine separately from each blog.

## Confirmed direction

- Name the project **SiteSeed**.
- Distribute it as an installable engine package, separate from users' blogs.
- Provide a terminal setup wizard through `npm run setup`.
- Default setup to the current directory, including a fresh SiteSeed checkout.
  Do not create a name-derived sibling folder. Keep explicit create/root options
  for users who want a separate project.
- Make website/sitemap import the primary migration path, independent of the
  source publishing platform. Keep Ghost exports as an optional richer input.
- Setup publishes all successfully extracted items with one final
  confirmation, not per-item review. Missing metadata uses explicit placeholders
  recorded in the Markdown and report. Standalone import commands retain manual
  preview/review and draft output. Never overwrite existing content or settings.
- Without an import, start with one published welcome post, one example draft,
  and an About page.
- Remove the old articles and replace the original site's content and branding.
- Remove site-specific assumptions from the engine.
- Add open-source project files and make deployment platform neutral.

## Proposed first-release boundaries

Keep the existing Markdown-first Express engine rather than rewriting it.
Preserve server-rendered pages, search, RSS, sitemaps, responsive images, tables,
bookmark cards, and content validation.

Start with one bundled theme. Do not add a database, browser-based editor,
plugin system, comments, memberships, or newsletters for the first release.

Keep user content and configuration outside an installed engine package.
A source checkout can also be used directly as the blog: setup preserves its
package, code, assets and unprompted settings. Engine upgrades must not overwrite
user content or configuration.

## Phase 1: Separate the engine from each blog

The application and build scripts now resolve blog-owned files from an explicit
blog directory rather than from their own source files.

- [x] Define the engine package and user-blog directory boundaries.
- [x] Introduce a shared way to resolve blog configuration, content, custom
  assets, and generated output.
- [x] Keep server code, rendering, the CLI, and default theme assets in the
  engine package.
- [x] Keep Markdown, media, site settings, and generated blog artifacts in the
  user's project, never inside the installed engine.
- [x] Refactor application creation and build commands to use those boundaries.
- [x] Define and validate configuration, with clear errors for invalid values.
- [x] Define configuration precedence and the role of environment overrides.
- [x] Establish the initial CLI commands and the scripts to expose in a blog.
  Automatic script generation remains part of the Phase 5 wizard.

Completion goal: the engine can run a blog in a separate directory, and an
engine upgrade leaves that blog's content and configuration unchanged.

### Phase 1 implementation notes

- The agreed layout is `siteseed.config.json`, `content\`, and `public\` at the
  blog root. Existing settings were initially migrated; the checkout now uses
  neutral settings and has no posts or pages.
- Root precedence is `--root`, then `SITESEED_ROOT`, then the current directory.
  `SITE_URL` overrides the configured origin.
- `createApp()` and `createTemplates()` create per-blog instances. Configuration,
  content snapshots, and render/asset caches are not shared between blogs.
- Build, content-check, and importer paths target the selected blog.
- The CLI exposes start, dev, build, targeted builds, check, website import,
  and optional Ghost import.
  Setup and project creation were added in Phase 5.
- Package contents are allowlisted to engine code and default theme assets.
  The package remains private; its registry name and license are not settled.
- External-blog tests cover settings, paths, assets, origins, caches, commands,
  and output isolation. An offline tarball smoke check also exercised installation,
  HTTP startup, and an upgrade to a temporary new version without changing user
  content or configuration.
- Validation has been performed on Windows. Linux coverage remains a release
  task.

## Phase 2: Remove site-specific assumptions

- [x] Make site title, description, author details, navigation, domain, logos,
  social image, timezone, and date formatting configurable.
- [x] Remove hardcoded author paths and personal legacy redirects. A
  user-defined migration redirect format remains an open decision.
- [x] Remove personal analytics IDs and site-specific restrictions; leave
  analytics disabled unless configured.
- [x] Generate robots metadata from the configured site origin rather than
  shipping a fixed sitemap URL.
- [x] Use the configured origin consistently in canonical URLs, RSS, and
  sitemaps, with a usable local-development default.
- [x] Separate generic page behavior from imported About, offline, and other
  historical route assumptions.
- [ ] Preserve Markdown escaping, asset protections, and cache behavior.
- [ ] Make draft previews available locally but disabled by default in
  production, covering both draft HTML and draft assets.

Completion goal: a new blog can be configured without editing engine source,
and its rendered output contains no former-site identity or domain assumptions.

## Phase 3: Replace content, branding, and test data

The old content has been removed. Tests use small, purpose-built fixtures while
preserving coverage for tables, bookmark cards, media rewriting, redirects, and
import behavior. Do not restore deleted posts as test dependencies.

- [x] Remove all old posts and their associated media from `content\posts`.
- [x] Remove or replace old pages, tags, author metadata and images, logos,
  and old crawl artifacts.
- [x] Add a neutral published welcome post through setup.
- [x] Add an example draft demonstrating the supported front matter and
  writing workflow.
- [x] Add a neutral About page and simple navigation through setup.
- [x] Use neutral SiteSeed text branding; custom artwork is optional.
- [x] Support a useful empty homepage when a user removes all published posts.
- [x] Replace real-blog test dependencies with isolated fixtures.
- [x] Rebuild search and image artifacts and remove obsolete generated assets.
- [x] Review repository instructions and personal project files so they no
  longer direct contributors to preserve the original site's behavior.

The distributed checkout starts empty. Default setup generates the welcome
post, example draft with artwork, and About page in that same checkout.
Explicit separate-project setup keeps content outside the engine checkout.

Completion goal: the starter contains only intentional example content, and
the test suite no longer needs the former blog's articles or assets.

## Phase 4: Platform-independent website import

Website import is the primary path. A sitemap discovers URLs; the importer
then extracts content and available metadata from each page. A sitemap is not
a content export, and this is a best-effort migration rather than a promise
of lossless conversion. Ghost JSON is an optional structured source, not an
engine requirement.

- [x] Accept a website or explicit sitemap URL independently of the new blog's origin.
- [x] Discover ordinary XML sitemaps, nested indexes, and gzip sitemaps without
  assuming filenames or source platforms. Website URLs use robots sitemap
  declarations, falling back to `/sitemap.xml`.
- [x] Extract article/main HTML, available metadata, images and downloads.
- [x] Share Markdown conversion and safe content/media writing between sources.
- [x] Generate an editable JSON preview before writing content or fetching media.
- [x] Allow exclusion of entries and review of titles, dates, slugs, bylines,
  posts/pages classification, body text, and media URLs.
- [x] Flag likely archives, ambiguous extraction, missing metadata, unsupported
  content and failed requests. Do not invent publication dates from sitemap lastmod.
- [x] Require a valid publication date before applying. Standalone commands write
  drafts; setup explicitly requests published output so posts appear immediately.
  Setup can fill missing, invalid or future dates with a flagged import-time
  placeholder; standalone import commands remain strict.
- [x] Give draft pages the same preview and isolated asset handling as draft
  posts, with private/no-store and noindex headers and inaccessible Markdown.
- [x] Accept an explicit Ghost export path and source URL; read export records
  without requiring a live sitemap.
- [x] Remove personal archive overrides and author fallbacks.
- [x] Preserve supported tables and bookmark cards, tag membership, bylines,
  posts/pages and downloaded media; combine multiple authors into a reviewable
  byline rather than inventing multi-author support.
- [x] Record source-to-destination URL mappings and rewrite links between
  selected items. Automatic old-site redirects remain a separate decision.
- [x] Refuse duplicate/reserved slugs and existing destinations across posts
  and pages. Stage and validate the batch before adding new content.
- [x] Leave site configuration, navigation, existing content and author/tag
  profile files unchanged.
- [x] Keep import commands separate from normal startup and rendering.
- [x] Test synthetic websites, nested sitemaps, Ghost exports, media failures,
  draft HTTP behavior, external blog roots, and rerun protection.
- [x] Integrate this workflow into the terminal setup wizard.

Current boundaries: no JavaScript execution, login/paywall access, selector
customization, or guaranteed extraction from arbitrary layouts. Ghost records
without an HTML body are reported as unsupported. Missing media remains remote
and is reported; unsupported active media such as SVG/HTML is not installed.
Standalone imports require missing publication dates to be supplied during
review. Setup keeps all extracted items and marks metadata placeholders for
later correction. Duplicate/reserved slugs receive unique safe names with
the changes recorded.
Author profiles and tag artwork are not migrated. Draft privacy remains a
Phase 2 task: draft status is not access control.

Completion goal: a user can import a non-Ghost website through preview and
review without editing engine code, with an actionable report of what was
not preserved. The standalone importer supports manual review; the setup
wizard publishes all extracted items without per-item questions.

## Phase 5: Build the terminal setup wizard

Implemented flow:

```text
Welcome to SiteSeed.

Blog name:
Blog directory: [current directory, or explicit create/root argument]
Your name:
Short description:
Website URL: [skip for local development]

Start with:
  Starter content
  Import from a website or sitemap
  Import a Ghost export (optional)

For imports:
  Discover content and show extraction failures
  Publish every extracted item in the new blog
  Flag metadata placeholders for later correction

Review settings
Create blog
Build assets and validate content
Install dependencies automatically
Show completion counts and the exact commands to start the blog
```

- [x] Collect only the settings needed to get started.
- [x] Generate ordinary, editable configuration and content files.
- [x] Offer starter content, website import, or optional Ghost export import;
  do not silently mix example posts into an imported blog.
- [x] Show the destination and proposed changes before writing blog files.
- [x] Handle cancellation, failures, existing files, and reruns safely.
- [x] Show progress during discovery, creation, builds, saving and installation.
- [x] Install dependencies automatically and report completion or recovery steps.
- [x] Explain how to start locally, find imported posts/pages, add media, and check content.
- [x] Leave logo, color, analytics, and advanced navigation setup optional.
- [x] Keep configuration editable without requiring the wizard.
- [x] Provide a bootstrap path for an empty directory.

Bootstrap: `npm run setup` in the checkout starts the wizard and writes the
blog in that directory. The blog name no longer determines a directory name,
and there is no folder prompt.
`siteseed create <directory>` and `siteseed setup --root <directory>` use the
same flow without requiring an existing blog config or package.json.
An explicit separate project exposes generated setup, start, dev, build, check,
and import scripts. In-place setup preserves the checkout's existing package
and scripts, with no dependency on itself.

Separate pre-release projects depend on the local engine through a `file:` dependency.
The wizard runs `npm install --offline --no-audit --no-fund` automatically, then
prints `npm run dev` in the same directory. A `cd` command is printed only
when an explicit destination differs from the current directory. It does not
start a server or deploy the blog. The local engine and its installed
dependencies must stay available. Publication and a distributable bootstrap
package remain release work, not prerequisites for testing the wizard locally.

Setup has no per-draft selection or editing step. It keeps all successfully
extracted content, including likely archive pages and source drafts/scheduled
posts, and asks for one final confirmation before publishing them in the new
blog. Missing metadata uses flagged placeholders; `import_notes` in
Markdown and adjustments in the report identify them. Date placeholders use
the import time, never an inferred original publication date.
The wizard stages and validates before writing. Separate destinations must be
empty. In a source checkout, it merges the confirmed settings, replaces only
empty generated indexes and adds new content without replacing code, package
files or theme assets. Existing content, linked destinations, and edits made
during setup block writing. Failed writes restore original files and remove
only the new files/directories owned by setup.
Ctrl+C cancels prompts and network requests. Existing blogs are never reset
by rerunning setup; settings remain editable in siteseed.config.json.
Installation failures or cancellation after saving retain the created blog
and print a retry command. Never claim that nothing was written in this case.
Interactive terminals show animated progress; piped output gets plain status
lines. Completion distinguishes import errors from a clean success, lists
published post/page counts, and tells the user that the server is not running yet.

Completion goal: a new user can create and preview a blog through the
documented terminal flow without editing engine code.

## Phase 6: Prepare the open-source package and neutral deployment

- [ ] Update package metadata and define the files included in the published
  engine package.
- [ ] Choose a license and add the corresponding license file.
- [ ] Add contribution guidance, security reporting instructions, and relevant
  third-party notices.
- [ ] Rewrite the README around SiteSeed setup, writing, configuration,
  importing, deployment, and upgrades.
- [ ] Document draft-preview behavior and trusted HTML explicitly.
- [ ] Add provider-neutral CI; the former deployment workflow has been removed.
- [x] Remove provider-specific assumptions from the default project; retain any
  provider-specific deployment examples only as optional examples.
- [ ] Define one build/start contract, required runtime dependencies, generated
  artifacts, and supported environment variables.
- [x] Document deployment to a compatible Node.js host without requiring a
  particular provider or cloud account.
- [ ] Verify the build-to-runtime handoff, including startup with only
  production dependencies installed.
- [ ] Document how engine upgrades preserve user configuration and content.

Completion goal: the repository and package can be used by someone unfamiliar
with the original blog or its deployment setup.

## Release acceptance checks

These checks apply to a packaged engine installed into a separate blog
directory, not only to the source checkout.

- [x] Fresh setup produces a working welcome post, About page, and draft.
- [x] Setup cancellation and reruns do not silently overwrite user files.
- [x] Setup defaults to the current directory and preserves checkout files and
  custom settings; explicit separate destinations still work.
- [x] The starter builds and runs without analytics or an import.
- [ ] Published routes, search, RSS, sitemaps, images, and metadata use the new
  blog's settings.
- [ ] Drafts stay out of published listings, search, RSS, and sitemaps; default
  production settings do not expose draft HTML or assets.
- [x] An empty published-content collection renders correctly.
- [x] Website import works without a Ghost export; Ghost HTML exports can be
  previewed without a live site.
- [x] Import failures and unsupported content produce clear reports; invalid
  dates and destination conflicts prevent writes.
- [x] Standalone imports remain drafts and do not alter existing content or settings.
  Setup imports are published in the newly created blog after confirmation.
- [ ] Engine upgrades preserve content, media, and configuration.
- [ ] The packaged release includes required runtime and theme files but
  excludes old blog content, exports, and personal artifacts.
- [ ] The full repository check passes, with Windows and Linux coverage for
  path handling and the generated CLI workflow.

## Decisions still open

- Package name availability and published bootstrap distribution.
- Future schema extensions; the configuration filename and blog directory
  layout are agreed and implemented.
- Single-author versus multiple-author support for the first release,
  including how Ghost imports map authors.
- License choice.
- User-defined redirect format and migration behavior.
- Whether to include a draft-creation command in the first release.
- Whether development automatically rebuilds search and image variants when
  content changes.
- Whether to ship an optional container example alongside generic Node.js
  deployment instructions.

## Next implementation step

Finish Phase 2 by disabling draft previews by default in production, then
complete license, packaging, CI and release decisions. The setup wizard and
starter content can now be exercised from a fresh local checkout.

Package review: `engines.node` now matches the installed image library's
`>=20.9.0` requirement, CommonJS is explicit, and the lockfile uses portable
public registry URLs with unchanged versions and integrity hashes. The package
remains private; license selection and registry-name verification are pending.
