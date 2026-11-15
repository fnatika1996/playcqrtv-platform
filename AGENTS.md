# CQRTV — Codex project instructions

This repository powers **playcqrtv.com**. The owner designs screens with ChatGPT, **approves visual mockups first**, and then asks Codex to implement them. Do not treat an exploratory design conversation as permission to code.

## Mandatory design reference

**Read docs/CQRTV_DESIGN_SYSTEM.md before any frontend/UI work.** It is the canonical guide to CQRTV's colors, typography, components, spacing, breakpoints, states and acceptance checklist.

- Dark esports UI: brand orange **#FF7629**, background **#101113**, panels **#17191D**, light text **#F3F3F2**.
- Fonts already used: **Lexend Deca** for UI and **Teko** for display headings.
- Preserve existing identity, icons and UI conventions. Do not invent an unrelated visual language.
- Desktop and phone mockups require explicit owner approval **before** implementing new visual designs or major layout changes.
- For an approved design task, follow the approved mockup first, the design standard second and existing code third. Flag any material conflict.
- Reuse existing UI components/styles where possible. Avoid scope creep and speculative redesigns.
- Verify responsiveness at 1440, 1024, 760, 390, 375 and 320px; test keyboard navigation, touch targets, contrast and all major states.

## Repository context

- Frontend is currently plain HTML with largely inline CSS/JS in **index.html**, **auth.html** and other .html pages.
- Auth API is in **api/server.mjs**. Preserve actual forms/API contracts, nickname checks, country selection, verification and password flows.
- Icons are selected from **Icon Play CQRTV.rar** in **.github/workflows/deploy.yml**; reuse the established selected set when possible.
- Do not introduce a new framework, font, icon library or large dependency as part of an ordinary UI request.
- The deployment workflow **automatically deploys pushes to main** to the live website. For design changes, work on a feature branch/PR until owner approval; do not merge or push unapproved changes to main.
- Do not alter deployment, hosting, credentials, auth logic or unrelated files during design tasks.

## Required working method

1. Inspect the affected files and identify existing behavior before modifying code.
2. Confirm the task is an **approved implementation** rather than a request for visual ideas. If approval is missing, create a brief design proposal/spec and ask for approval **without changing UI code**.
3. Make the smallest coherent changes needed to match the approved desktop/mobile design.
4. Check existing behavior and accessibility; do not break registration/login/matchmaking-related flows.
5. Report changed files, verification performed, screenshots/comparison if available, and anything that differs from the approved mockup.
6. Keep design-system updates intentional and versioned; update docs/CQRTV_DESIGN_SYSTEM.md when the owner approves a new global rule.

Documentation-only edits may be proposed in a branch without a new visual mockup. Never assume a documentation PR is already merged into main.
