# ADR-004: Frontend styling — CSS Modules + design tokens (not Tailwind)

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** Stakeholder + orchestrator
- **Increment:** INC-1

## Context

The design system (`specs/ui/design-system.md`) is expressed as CSS custom properties
(color, typography, spacing, motion). The prototypes already use plain CSS + tokens. The
project's north star is **readable code for a live demo** — minimal build magic.

Options: **CSS Modules + CSS variables**, **Tailwind CSS**, CSS-in-JS.

## Decision

Use **CSS Modules + CSS custom properties** that map 1:1 to the design-system tokens.
Icons are inline **Lucide-style SVG** (no emoji). Motion tokens (custom easings, press
feedback, `@starting-style`, `prefers-reduced-motion`) are carried over from the design
system.

## Consequences

- **Positive:** Prototypes translate almost verbatim; no utility-class indirection to explain
  on stage; tokens are the single source of truth.
- **Positive:** No extra build tooling/config beyond Next.js defaults.
- **Negative / trade-offs:** Less utility-class velocity than Tailwind; the team writes a
  little more CSS (acceptable for a small demo). Revisit if the surface grows.
