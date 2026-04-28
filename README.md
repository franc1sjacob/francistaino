# Francis Taino's Personal Website

This is the source code for my personal website, built with [Astro](https://astro.build) and deployed on GitHub Pages.

## About

I'm Francis Taino, a software engineer based in Manila. The site is where I keep my work, projects, and the occasional blog post.

## Project Structure

```text
├── public/                      # Static assets (favicons, og image, robots.txt, CNAME)
├── src/
│   ├── components/              # Reusable UI pieces
│   ├── content/
│   │   └── blog/                # Blog posts in Markdown
│   ├── content.config.ts        # Blog collection schema
│   ├── data/
│   │   └── projects.ts          # Projects list
│   ├── layouts/
│   │   └── BaseLayout.astro     # HTML shell + SEO meta + theme script
│   ├── pages/                   # Routes
│   │   ├── index.astro          # Home
│   │   ├── about.astro          # Bio, work, education
│   │   ├── 404.astro            # Custom 404
│   │   ├── projects/
│   │   ├── blog/
│   │   │   ├── index.astro
│   │   │   └── [...slug].astro  # Dynamic route per post
│   │   └── rss.xml.js           # RSS feed
│   └── styles/
│       └── global.css           # CSS variables, base typography, post-body styles
├── .github/workflows/deploy.yml # GitHub Actions deploy workflow
├── astro.config.mjs             # Site URL, sitemap, prefetch, shiki theme
├── package.json
└── LICENSE
```

## Conventions

- **Component-scoped styles** in `<style>` blocks for anything used in one place
- **Global styles** in `src/styles/global.css` for CSS variables, base typography, and shared utilities (`.container`, `.item`, `.line`, post-body styles)
- **Blog posts** live in `src/content/blog/` as `.md` files. Prefix the filename with `_` to hide a draft from the site and RSS feed
- **Theme** toggled via `data-theme` attribute on `<html>`, persisted to `localStorage`, set inline in `<head>` to avoid the light-mode flash

## Adding a Blog Post

Create a new `.md` file in `src/content/blog/`:

```md
---
title: Post title
description: One-line summary for SEO and the post list
publishedAt: 2026-04-28
tags: [tag-one, tag-two]
---

Markdown content here.
```

The slug comes from the filename. Prefix with `_` to draft.

## Commands

| Command           | Action                                     |
| :---------------- | :----------------------------------------- |
| `bun install`     | Install dependencies                       |
| `bun run dev`     | Start local dev server at `localhost:4321` |
| `bun run build`   | Build the production site to `./dist/`     |
| `bun run preview` | Preview the build locally before deploying |
| `bun run check`   | Run `astro check` for type errors          |

## Deployment

This site is deployed to GitHub Pages via GitHub Actions. Pushes to `main` automatically trigger a build and deploy through the [`withastro/action`](https://github.com/withastro/action) workflow.

DNS is managed at Namecheap with `A` records pointing to GitHub's anycast IPs and a `CNAME` for `www`.

## License

This repository uses dual licensing:

- **Documentation & Blog Posts**: Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Code & Code Snippets**: Licensed under the [MIT License](https://opensource.org/licenses/MIT)

See [LICENSE](./LICENSE) for full details.
