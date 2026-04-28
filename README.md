# francistaino.com

My personal site - portfolio, projects, and writing. Built with [Astro](https://astro.build).

## Stack

- [Astro 6](https://astro.build) - static site generation, content collections
- Vanilla CSS with CSS variables (no Tailwind, no preprocessor)
- Markdown for blog posts via Astro content collections
- [Shiki](https://shiki.style) for syntax highlighting (built into Astro)
- Bun as the package manager

## Project structure

```text
/
├── public/
│   ├── favicon.svg
│   └── robots.txt
├── src/
│   ├── components/          # reusable UI pieces
│   ├── content/
│   │   └── blog/            # blog posts as .md files
│   ├── content.config.ts    # blog collection schema
│   ├── data/
│   │   └── projects.ts      # projects list
│   ├── layouts/
│   │   └── BaseLayout.astro # html shell + SEO meta + theme script
│   ├── pages/
│   │   ├── index.astro      # home
│   │   ├── about.astro      # bio, work, education
│   │   ├── projects/
│   │   ├── blog/
│   │   │   ├── index.astro
│   │   │   └── [...slug].astro  # dynamic route per post
│   │   └── rss.xml.js       # RSS feed
│   └── styles/
│       └── global.css       # CSS variables, base typography, post-body styles
├── astro.config.mjs         # site URL, sitemap, prefetch, shiki theme
└── package.json
```

## Conventions

- **Component-scoped styles** in `<style>` blocks for anything used in one place
- **Global styles** in `src/styles/global.css` for variables, base typography, and shared utilities (`.container`, `.item`, `.line`, post-body styles)
- **Blog posts** live in `src/content/blog/` as `.md` files with frontmatter (`title`, `description`, `publishedAt`, `tags`, `draft`)
- **Theme** toggled via `data-theme` attribute on `<html>`, persisted to `localStorage`, set inline in `<head>` to avoid flash on light mode

## Adding a blog post

Create a new `.md` file in `src/content/blog/`:

```md
---
title: Post title
description: One-line summary for SEO and the post list
publishedAt: 2026-04-28
tags: [tag-one, tag-two]
draft: false
---

Markdown content here.
```

The slug comes from the filename. Set `draft: true` to hide a post from the site and feed.

## Commands

| Command         | Action                                      |
| :-------------- | :------------------------------------------ |
| `bun install`   | Install dependencies                        |
| `bun dev`       | Dev server at `localhost:4321`              |
| `bun build`     | Build to `./dist/`                          |
| `bun preview`   | Preview the build locally                   |
| `bun astro ...` | Run Astro CLI commands (e.g. `astro check`) |

## SEO

- Sitemap auto-generated at `/sitemap-index.xml` via `@astrojs/sitemap`
- RSS feed at `/rss.xml`
- OpenGraph + Twitter card meta in `BaseLayout.astro`
- `robots.txt` in `public/` points at the sitemap
- `site:` URL set in `astro.config.mjs` (required for canonical URLs)
