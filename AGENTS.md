# CQRTV — Codex project instructions

This repository powers **playcqrtv.com**. The owner designs screens with ChatGPT, **approves visual mockups first**, and then asks Codex to implement them. Do not treat an exploratory design conversation as permission to code.

## Roles and decision authority — mandatory

This project intentionally separates **visual design** from **engineering**:

- **Owner / product decision-maker:** decides product priorities, requirements, budgets, feature acceptance, what is released and when; approves visual mockups and production-impacting changes.
- **ChatGPT (browser) / design lead:** owns CQRTV visual direction, branding, page layout, colors, typography, spacing, component appearance, user experience and desktop/mobile mockups. Prepares the **owner-approved** design specification/acceptance criteria for Codex.
- **Codex (desktop) / engineering lead:** owns technical implementation and verification, **not independent visual design**. Codex can write/refactor frontend HTML, CSS and JavaScript to implement the approved mockup precisely. Codex also handles backend services and APIs, data models and migrations, login/registration integrations, CS2 matchmaking logic, Steam/FACEIT integrations where permitted, bugs, tests, debugging, performance, accessibility implementation, security review, CI/infrastructure proposals and release readiness.

**Boundaries:**

1. Do **not** independently create, restyle, redesign, or replace page layouts, typography, color schemes, icons, assets, animations or branding. Do not make unrequested visual "improvements".
2. **Approved design/UI task:** implement the supplied mockup/spec pixel-consciously for desktop and mobile while preserving functionality; if visually underspecified or technically infeasible, describe the tradeoff to the owner and ask for an updated approved design instead of improvising.
3. **Technical task without design implications:** proceed with normal authorized engineering (bugs, tests, API/backend, code maintenance). An approved visual mockup is **not** required for backend-only changes or invisible fixes.
4. **Bug with visible UI implications:** make only the minimum necessary non-design fix within the existing standard; if it changes presentation materially, request the designer's approved specification first.
5. Codex is allowed to give feedback about feasibility, accessibility, usability risks, performance and security. It may point out a design issue but **does not unilaterally redesign it**.
6. Never assume that a successful build, a new commit or a request to work on a feature authorizes production deployment. **Pushes to main auto-deploy**; use feature branches and obtain explicit owner authorization before merge or production-affecting changes.
7. Report results in concise Russian to the owner unless asked otherwise; summarize what was implemented, tested, what remains, and any needed decisions.

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
2. For any new or material visual change, require an **owner-approved** design/spec from ChatGPT. If it is missing, ask for it rather than creating a new design; do not alter UI code. Purely technical work does not require a visual mockup.
3. Make the smallest coherent changes needed to match the approved desktop/mobile design.
4. Check existing behavior and accessibility; do not break registration/login/matchmaking-related flows.
5. Report changed files, verification performed, screenshots/comparison if available, and anything that differs from the approved mockup.
6. Keep design-system updates intentional and versioned; update docs/CQRTV_DESIGN_SYSTEM.md when the owner approves a new global rule.

Documentation-only edits may be proposed in a branch without a new visual mockup. Never assume a documentation PR is already merged into main.
