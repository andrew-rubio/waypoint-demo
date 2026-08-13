---
name: ui-ux-pro-max
description: >-
  Comprehensive UI/UX design guide with a searchable database of 67 styles, 96
  color palettes, 57 font pairings, 99 UX guidelines, and 25 chart types across
  13 technology stacks. Generates complete design-system recommendations (style,
  colors, typography, pattern, effects, anti-patterns) and answers detailed
  style/color/typography/landing/chart/ux/stack queries via a BM25 search engine.
  USE WHEN designing, building, reviewing, or improving any web/mobile UI and you
  need grounded style, palette, font-pairing, layout-pattern, or stack-specific
  guidance. Runs on Node (no Python required).
---

# UI/UX Pro Max

A priority-based design recommendation engine backed by curated CSV datasets and
a BM25 search ranker. Use it to ground UI/UX decisions in concrete styles,
palettes, font pairings, landing patterns, chart choices, UX rules, and
stack-specific best practices.

> **Runtime:** Node.js only (no Python). All commands below run `search.mjs`.
> The data lives in `data/` next to this skill and is fully self-contained.

## Quick start

Always start with `--design-system` to get a complete, reasoned recommendation,
then supplement with targeted domain/stack searches as needed.

```bash
node .github/skills/ui-ux-pro-max/scripts/search.mjs "<product_type> <industry> <keywords>" --design-system [-p "Project Name"]
```

Example:

```bash
node .github/skills/ui-ux-pro-max/scripts/search.mjs "beauty spa wellness service elegant" --design-system -p "Serenity Spa"
```

## Workflow

When the user requests UI/UX work (design, build, create, implement, review, fix, improve):

### Step 1 — Analyze the request
Extract: **product type** (SaaS, e-commerce, portfolio, dashboard, landing…),
**style keywords** (minimal, playful, elegant, dark mode…), **industry**
(healthcare, fintech, gaming, education…), and **stack** (default `html-tailwind`).

### Step 2 — Generate the design system (REQUIRED)
```bash
node .github/skills/ui-ux-pro-max/scripts/search.mjs "<query>" --design-system [-p "Project Name"]
```
Returns: pattern, style, colors, typography, key effects, and anti-patterns,
with a pre-delivery checklist. Add `-f markdown` for documentation-friendly output.

### Step 2b — Persist (optional, Master + Overrides pattern)
```bash
node .github/skills/ui-ux-pro-max/scripts/search.mjs "<query>" --design-system --persist -p "Project Name" [--page "dashboard"]
```
Creates `design-system/<project-slug>/MASTER.md` (global source of truth) and,
with `--page`, a `pages/<page>.md` override file. When building a page, check the
page file first; if it exists, its rules override MASTER.md, otherwise use MASTER.md.

### Step 3 — Supplement with domain searches
```bash
node .github/skills/ui-ux-pro-max/scripts/search.mjs "<keyword>" --domain <domain> [-n <max_results>]
```

| Need | Domain | Example |
|------|--------|---------|
| More style options | `style` | `"glassmorphism dark" --domain style` |
| Color palettes | `color` | `"fintech crypto" --domain color` |
| Font pairings | `typography` | `"elegant luxury serif" --domain typography` |
| Landing structure | `landing` | `"hero social-proof" --domain landing` |
| Chart recommendations | `chart` | `"real-time dashboard" --domain chart` |
| UX best practices | `ux` | `"animation accessibility" --domain ux` |
| Product recommendations | `product` | `"healthcare saas" --domain product` |
| React performance | `react` | `"suspense waterfall" --domain react` |
| Web a11y/semantics | `web` | `"aria focus keyboard" --domain web` |
| Icon guidance | `icons` | `"navigation lucide" --domain icons` |

Omit `--domain` to auto-detect the best domain from the query.

### Step 4 — Stack guidelines (default: html-tailwind)
```bash
node .github/skills/ui-ux-pro-max/scripts/search.mjs "<keyword>" --stack html-tailwind
```
Available stacks: `html-tailwind`, `react`, `nextjs`, `astro`, `vue`, `nuxtjs`,
`nuxt-ui`, `svelte`, `swiftui`, `react-native`, `flutter`, `shadcn`, `jetpack-compose`.

**Then:** synthesize the design system + detailed searches and implement.

## Flags

| Flag | Alias | Purpose |
|------|-------|---------|
| `--domain` | `-d` | Force a search domain |
| `--stack` | `-s` | Search stack-specific guidelines |
| `--max-results` | `-n` | Max results (default 3) |
| `--design-system` | `-ds` | Generate a complete design system |
| `--project-name` | `-p` | Project name for output header |
| `--format` | `-f` | `ascii` (default) or `markdown` |
| `--persist` | | Save design system to `design-system/<slug>/MASTER.md` |
| `--page` | | Create a page-specific override file |
| `--output-dir` | `-o` | Output directory for persisted files |
| `--json` | | Emit raw JSON (domain/stack searches) |

## Common rules for professional UI

These frequently overlooked issues make UI look unprofessional:

- **No emoji icons** — use SVG icons (Heroicons, Lucide, Simple Icons), not 🎨🚀⚙️.
- **Stable hover states** — animate color/opacity/shadow; avoid scale transforms that shift layout.
- **Consistent icon sizing** — fixed 24×24 viewBox, `w-6 h-6`.
- **cursor-pointer** on every clickable/hoverable element.
- **Smooth transitions** — 150–300ms; never instant, never >500ms.
- **Light-mode contrast** — body text ≥ 4.5:1 (`#0F172A` text, `#475569` muted minimum); glass cards `bg-white/80`+; visible borders (`border-gray-200`).
- **Floating navbars** — inset from edges; never hide content behind fixed elements.
- **Consistent max-width** — don't mix container widths.

## Pre-delivery checklist

- [ ] No emojis used as icons (SVG instead)
- [ ] All icons from one set (Heroicons/Lucide); brand logos verified
- [ ] Hover states don't cause layout shift
- [ ] All clickable elements have `cursor-pointer`
- [ ] Transitions smooth (150–300ms); focus states visible for keyboard nav
- [ ] Light-mode text contrast ≥ 4.5:1; transparent elements and borders visible in both modes
- [ ] Responsive at 375px, 768px, 1024px, 1440px; no horizontal scroll on mobile
- [ ] No content hidden behind fixed navbars
- [ ] All images have alt text; form inputs have labels; color not the only indicator
- [ ] `prefers-reduced-motion` respected

## Tips

1. Be specific — "healthcare SaaS dashboard" beats "app".
2. Search multiple times — different keywords reveal different insights.
3. Combine domains — Style + Typography + Color = a complete system.
4. Always check `ux` for "animation", "z-index", "accessibility".
5. Use `--stack` for implementation-specific best practices.
