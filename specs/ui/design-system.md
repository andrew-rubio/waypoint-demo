# Design System — Waypoint

> Phase 1b artifact. Grounded in the `ui-ux-pro-max` recommendation (Soft UI Evolution,
> fresh-cyan palette, Figtree/Noto Sans, WCAG AA+) and refined with the `emil-design-eng`
> craft principles (custom easings, press feedback, origin-aware motion, reduced-motion).
> These tokens are binding for the Web slice implementation.

## Design principles

1. **Two audiences, two surfaces.** The **chat** is warm, calm, traveller-facing. The
   **audit panel** is a cooler technical slate — deliberately "developer console" so a
   presenter can visually separate them on stage.
2. **Clarity over decoration.** This is a demo whose code is read aloud; the UI mirrors
   that — obvious hierarchy, minimal chrome.
3. **Motion has a job.** Animate entrances (messages, cards, panel), press feedback, and
   status changes. Never animate high-frequency/keyboard actions. Always honour
   `prefers-reduced-motion`.
4. **SVG icons only** (Lucide-style), never emoji. Every clickable element gets
   `cursor-pointer` and a visible focus ring.

## Color tokens

Traveller surface (chat) — fresh cyan, sky/sea associations:

| Token | Hex | Use |
|-------|-----|-----|
| `--color-primary` | `#0891B2` | Primary actions, links, user message accent |
| `--color-primary-hover` | `#0E7490` | Hover for primary |
| `--color-secondary` | `#22D3EE` | Highlights, focus glow, active tabs |
| `--color-accent` | `#F59E0B` | Travel warmth — "best" badges, destination pins |
| `--color-success` | `#16A34A` | Confirmations, applied-preference note, `ok` status |
| `--color-warning` | `#D97706` | Degraded notices, preference/points callouts |
| `--color-error` | `#DC2626` | Errors, `error` status |
| `--color-bg` | `#F5F9FB` | App background (near-white, faint cool tint) |
| `--color-surface` | `#FFFFFF` | Cards, composer, message bubbles |
| `--color-text` | `#164E63` | Primary text (contrast ≥ 4.5:1 on surface) |
| `--color-text-muted` | `#475569` | Secondary text (meets AA on surface) |
| `--color-border` | `#CBD5E1` | Card/hairline borders |

Developer surface (audit panel) — cool slate:

| Token | Hex | Use |
|-------|-----|-----|
| `--audit-bg` | `#0F172A` | Audit panel background (slate-900) |
| `--audit-surface` | `#1E293B` | Audit entry cards (slate-800) |
| `--audit-text` | `#E2E8F0` | Audit text (slate-200) |
| `--audit-muted` | `#94A3B8` | Audit secondary text (slate-400) |
| `--audit-border` | `#334155` | Audit hairlines |

Status/type accents (audit badges): decision `#818CF8` (indigo), skill `#22D3EE` (cyan),
mcp `#34D399` (emerald), api `#FBBF24` (amber); status pending `#94A3B8`, ok `#34D399`,
error `#F87171`.

## Typography

```css
@import url('https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Noto+Sans:wght@400;500;700&display=swap');
--font-heading: 'Figtree', system-ui, sans-serif;
--font-body: 'Noto Sans', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace; /* audit values */
```

Scale (1.25 ratio):

| Token | Size / line-height | Use |
|-------|--------------------|-----|
| `--text-xs` | 12 / 16 | Audit meta, timestamps, badges |
| `--text-sm` | 14 / 20 | Card meta, captions |
| `--text-base` | 16 / 24 | Body, messages |
| `--text-lg` | 20 / 28 | Card titles |
| `--text-xl` | 25 / 32 | Section headings |
| `--text-2xl` | 31 / 38 | Welcome headline |

## Spacing, radius, shadow (4px grid)

```css
--space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px;
--space-5:20px; --space-6:24px; --space-8:32px; --space-12:48px;
--radius-sm:6px; --radius-md:10px; --radius-lg:16px; --radius-full:9999px;
/* Improved soft-UI shadows — softer than flat, clearer than neumorphism */
--shadow-sm:0 1px 2px rgba(15,23,42,.06), 0 1px 3px rgba(15,23,42,.10);
--shadow-md:0 4px 12px rgba(15,23,42,.08), 0 2px 4px rgba(15,23,42,.06);
--shadow-lg:0 12px 32px rgba(15,23,42,.12), 0 4px 8px rgba(15,23,42,.08);
```

## Motion tokens (Emil craft layer)

```css
/* Custom curves — the built-in CSS easings are too weak */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);       /* entrances, feedback */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);   /* on-screen movement */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);    /* audit panel slide */

--dur-press:140ms;      /* button :active */
--dur-fast:180ms;       /* chips, tooltips */
--dur-card:220ms;       /* message/card entrance */
--dur-panel:320ms;      /* audit drawer */
```

Rules:
- **Press feedback:** every pressable element gets `transform: scale(0.97)` on `:active`
  with `transition: transform var(--dur-press) var(--ease-out)`.
- **Entrances:** messages/cards enter from `scale(0.98)` + `opacity:0` + `translateY(6px)`
  via `@starting-style` (never from `scale(0)`). Use `ease-out`.
- **Audit panel:** slides from the right edge using `translateX(100%)` → `0` with
  `--ease-drawer` over `--dur-panel`; `transform-origin` right.
- **Never animate** the audit toggle's high-frequency reuse beyond the panel slide; the
  toggle itself is instant.
- **Streaming caret / spinners:** `linear`, subtle; a slightly faster spinner reads as faster.
- **Reduced motion:** wrap all non-essential motion in
  `@media (prefers-reduced-motion: no-preference)`; provide instant fallbacks.

## Responsive breakpoints

| Name | Width | Layout |
|------|-------|--------|
| mobile | 375px | Single column; audit panel becomes a **bottom sheet** (slides up, ~72vh, rounded top corners) |
| tablet | 768px | Chat centred (max 720px); audit overlays from right |
| desktop | 1024px | Chat + audit **side-by-side** (chat flex, audit 380px) |
| wide | 1440px | Chat max 760px centred; audit 420px |

No horizontal scroll at any width. Content never hidden behind the fixed header.

## Accessibility baseline

- Body text contrast ≥ 4.5:1; status is never colour-only (icon + label accompany colour).
- All interactive elements keyboard-reachable with visible focus (`2px` `--color-secondary`
  outline, `2px` offset). Composer submits on Enter; Shift+Enter for newline.
- Audit toggle is a labelled `button` with `aria-pressed`; panel is `role="complementary"`
  with an accessible name; streamed replies live in an `aria-live="polite"` region.
- All images/icons have text alternatives; every input has an associated label.
