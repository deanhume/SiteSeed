# A simple open-source blogging tool

Recorded: September 29, 2026.

Status: Proposal only. The wizard and commands described below are proposed features, not existing functionality.

## Product direction

Turn this application into a Markdown-first blog starter, not a smaller version of Ghost.

The promise:

> Answer a few questions, write a post, publish your blog.

Keep the initial experience free of database setup, admin accounts, and infrastructure decisions. Aim for a working local blog within a few minutes.

Start by extracting the existing application rather than rewriting it in another framework.

## 1. Extract a clean, reusable core

Separate the blogging engine from the original site's content and branding:

- Put the site name, description, author, navigation, logo, and domain in one configuration file.
- Include a small set of example posts demonstrating images, tables, and bookmark cards.
- Remove personal analytics IDs, historical redirects, and site-specific assumptions from the starter.
- Preserve the existing Markdown content folders, search, RSS, responsive images, and server-rendered pages.
- Keep users' content and configuration separate from engine code so future updates do not overwrite their work.

The starter should work without configuring analytics or external services.

## 2. Make the setup wizard the main entry point

The proposed experience:

```text
Welcome! Let's create your blog.

What is your blog called?  My Notes
Your name?                Alex
A short description?      Notes on writing and learning.
Do you have a domain?     [Skip for now]

Start with:
> An example blog
  Import an existing Ghost blog

Your blog is ready.

  Start writing: content/posts/hello-world/index.md
  Preview:       npm run dev
```

Ask only what is necessary to get started:

- Use one good default theme and sensible navigation.
- Leave analytics off.
- Make the domain optional for local use.
- Leave logo, colors, and other customization until later.
- Generate ordinary files that users can understand and edit.
- Do not require users to rerun the wizard to change their settings.

## 3. Make everyday writing just as easy

Provide a small set of commands:

| Proposed command | Purpose |
|---|---|
| `npm run new` | Create a draft with the correct folder, slug, and front matter. |
| `npm run dev` | Preview locally and refresh as files change. |
| `npm run check` | Find publishing problems before deployment. |
| `npm run publish` | Guide the user through publishing preparation. |

Creating a post should ask for its title, generate its folder and slug, and explain where to put images.

Error messages should identify the file, explain the problem, and show how to fix it. Users should not need to understand the renderer or build scripts to resolve a missing image or invalid date.

Improve the development loop so image variants and search rebuild automatically when their inputs change. Users should not have to remember separate generator commands.

## 4. Offer one straightforward publishing path

Document and support one deployment route well before adding several.

The publishing guide should cover:

- Choosing and configuring the deployment destination.
- Adding a domain and enabling HTTPS.
- Supplying any required credentials without putting them in generated configuration or source control.
- Updating an already-published blog.

Draft previews must be disabled or access-controlled in production. Hiding them from search engines is not access control.

Keep Ghost import optional. It should produce a clear report of anything it could not preserve, including missing media or unsupported content, rather than silently dropping information.

## 5. Package it for new users

Before the initial release:

- Choose an explicit license and include only suitable example content and assets.
- Add a short quick-start guide with screenshots.
- Test the complete wizard-to-published-blog journey in a fresh directory.
- Explain how users receive engine updates without overwriting content or configuration.

The documentation should work for someone who has never seen this repository or used its existing deployment setup.

## First-release scope

Include:

- One theme.
- One setup wizard.
- Markdown editing with a draft-creation command.
- Local preview and publishing checks.
- Search, RSS, responsive images, tables, and bookmark cards.
- Optional Ghost import.
- One documented deployment path.

Leave out until real users demonstrate a need:

- A browser-based editor.
- Plugins.
- Comments.
- Memberships.
- Newsletters.

The first release succeeds when someone unfamiliar with the project can create a blog, write a post, and publish it without needing to understand the application internals.
