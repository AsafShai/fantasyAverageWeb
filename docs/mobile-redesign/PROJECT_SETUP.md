# Setting up a Claude Project for the mobile redesign

## 1. Create the project
- Name: **Fantasy League — mobile redesign**
- Connect GitHub repo **AsafShai/fantasyAverageWeb** (branch **dev** once these docs are merged there) and add the folder **`docs/mobile-redesign/`** to the project knowledge. If GitHub sync isn’t available, upload these files manually:
  - `HANDOFF.md`, `PARITY.md`, `prototype.html`
  - the screenshots you’re working on from `screens/` (e.g. `01-today.jpg`, `06-…09-team-*.jpg`)
- Optional: also add `frontend/src/App.tsx`, `frontend/src/components/Layout.tsx`, `frontend/src/config/featureFlags.ts` for context.

## 2. Paste as the project’s custom instructions
```
You are helping implement an approved mobile redesign of a fantasy basketball web app
(React + Vite + Tailwind + RTK Query frontend, FastAPI backend; repo AsafShai/fantasyAverageWeb, base branch dev).

Source of truth: docs/mobile-redesign/HANDOFF.md (rules, design system, page decisions, plan),
PARITY.md (acceptance checklist per page) and the screenshots in docs/mobile-redesign/screens/.
The clickable prototype is docs/mobile-redesign/prototype.html.

Rules:
- Mobile only (below the md breakpoint); desktop unchanged.
- Same information and features as the live site — never drop a feature, column, filter or visual,
  and never add new features, derived advice or data from unrelated pages.
- Reorganising within a page is fine (tabs, filter sheet, cards, pinned first column).
- It is a mobile website, not an app: real URLs per view, browser back works, bottom tab bar stays.
- Roto league (12 teams, 8 categories), not head-to-head.
- Everything new goes behind FF_MOBILE_REDESIGN (+ runtime override ?ff=mobile).
- Work in small PRs following the sequence in HANDOFF.md §6; each PR must satisfy its PARITY.md section,
  keep existing tests green, add tests, and be checked at 390 px.
When something in the screenshots conflicts with the live site’s data or behaviour, keep the live behaviour
and ask.
```

## 3. Which Claude to use for what
- **Claude Project (chat):** planning, reviewing a PR against the screenshots/PARITY, writing component specs. It can’t run the app or push code.
- **Claude Code (web or CLI) on the repo:** the actual implementation PRs (it can run tests, Playwright at 390 px and push branches). Point it at `docs/mobile-redesign/HANDOFF.md` at the start of each session.
- The design canvas link in HANDOFF.md is viewable by you in the browser; other Claude sessions may not be able to open it, which is why everything they need is exported into this folder.
