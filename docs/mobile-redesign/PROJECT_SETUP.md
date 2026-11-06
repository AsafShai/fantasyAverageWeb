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

Reporting (every step, never skip):
- Before coding: say which step of the plan this is, what will change and what will not.
- While working: list the commands you run; paste test / build / lint output in your reply verbatim
  (failures in full), don't just say "tests pass".
- After coding: explain what changed and why, file by file; take live screenshots at 390 px of every
  page/state you touched (Playwright against the running dev server, flag on) and show them next to the
  matching design screenshot from docs/mobile-redesign/screens/; tick the PARITY.md items for that page
  and call out anything missing or different.
- End with: open questions, what's next, and the branch / PR link.
```

## 3. One step = one session

The Project does not start steps by itself. Start one Claude Code session per step (one PR each) with:

```
Read docs/mobile-redesign/HANDOFF.md and PARITY.md. Do step <N> of §6 (<name of the step>)
on a new branch from dev. Follow the reporting rules in docs/mobile-redesign/PROJECT_SETUP.md:
explain the plan first, show commands and test output verbatim, and finish with live 390 px
screenshots next to the matching design screenshots plus the PARITY checklist for the pages touched.
Open a PR to dev when done.
```

Review the screenshots and PR, merge, then start the next step the same way.

## 4. Which Claude to use for what
- **Claude Project (chat):** planning, reviewing a PR against the screenshots/PARITY, writing component specs. It can’t run the app or push code.
- **Claude Code (web or CLI) on the repo:** the actual implementation PRs (it can run tests, Playwright at 390 px and push branches). Point it at `docs/mobile-redesign/HANDOFF.md` at the start of each session.
- The design canvas link in HANDOFF.md is for you. A Project chat most likely can’t open it, and Claude Code would only get the design source, not a picture — so the screenshots in `screens/` (and `prototype.html`) are what the agents compare against.
