# Prompt — 2-minute demo video (offseason 2026 features)

Copy everything below into a fresh Claude Code session at the repo root.

---

Build a ~2-minute demo video of the offseason features of this app, using the Remotion project already scaffolded in `video/` (Remotion 4.0.515, React 19, Tailwind v4 — currently untouched boilerplate).

## Source material — read before writing any code

- `docs/demo/build/content.json` — the slide copy of the existing PowerPoint. It is the authoritative feature list and wording. Reuse its phrasing; do not invent new claims.
- `docs/demo/build/build_deck.js` — the deck's visual language. Match it exactly: DARK `#14213D`, DEEP `#22314F`, AMBER `#FCA311`, LIGHT `#FAFAF8`, INK `#1B2430`, MUTED `#5C6B7F`; headings Bookman Old Style, body Calibri.
- `docs/demo/shots/` — 26 screenshots, numbered by section. `docs/demo/shots/crop/` holds tighter crops of 17 of them — prefer the crops, they read better at video scale.
- `docs/demo/offseason-2026-whats-new.pdf` — the finished deck, for reference on pacing and hierarchy.

## Missing footage — capture it yourself

The deck was built 2026-08-15. Three areas changed after it and have **no screenshots**. Capture them before building the video:

- **Standings Race** — now plots the league's actual scoring categories (PR #217), not a hardcoded 8.
- **Player Rankings** — z-scores over the league's real categories, Ranked/Raw toggle, sticky Team column.
- **Slot usage** — roster-slot config consolidated, behind-pace threshold fixed.

To get a running app with real data, follow the docstring at the top of `scripts/demo_api/server.py`:

```
# terminal 1 — real backend, real league, completed season
LEAGUE_ID=660330196 SEASON_ID=2026 uv run uvicorn app.main:app --port 8000

# terminal 2 — demo overlay on :8010 (injury PDF, minigame leaderboards, live slate)
uv run python ../scripts/demo_api/server.py

# terminal 3 — frontend with every feature flag on
npm run dev -- --mode demo
```

`frontend/.env.demo` already enables all the flags.

Capture **two things** per new area, with Playwright at 1920x1080:

1. A still, saved into `docs/demo/shots/` following the existing numbering, cropped into `shots/crop/` the same way `docs/demo/build/crop.py` does.
2. A short screen recording (`recordVideo`, 5-10s) of the actual interaction — Standings Race animating through the season, the Rankings weight sliders moving and rows reordering, a Ranked/Raw toggle, the slot bars filling. Save to `docs/demo/clips/`.

The recordings matter more than the stills. Do the interaction slowly and deliberately; a fast mouse looks like a glitch on screen.

Also grab one 390px mobile shot for the closing montage.

## The video

- 1920x1080, 30fps, ~3600 frames (120s). Output `docs/demo/offseason-2026-demo.mp4`.
- No voiceover. On-screen text only.
- **Text is Hebrew, RTL** (`dir="rtl"`, right-aligned). Feature names stay in English, because that is what the UI says: e.g. `Trends — מי קיבל דקות`. Two short lines max per beat — a feature name and one line of what it does. Nobody reads a paragraph off a video.
- Structure: title card (3s) → 11 feature beats → closing card (4s).
- The three areas that changed after the deck lead, and get the most time — they are the point of this video:

  | # | Beat | Length | Footage |
  |---|------|--------|---------|
  | 1 | Standings Race (dynamic categories) | 14s | recording |
  | 2 | Player Rankings (weights, Ranked/Raw) | 14s | recording |
  | 3 | Slot usage | 10s | recording |
  | 4 | Trends — minutes | 10s | still + chart expand |
  | 5 | Trends — usage / role | 8s | still |
  | 6 | Trends — shooting regression | 8s | still |
  | 7 | Projections | 10s | still |
  | 8 | Matchup Quality | 8s | still |
  | 9 | Player Page | 10s | still |
  | 10 | Custom ranges | 7s | still |
  | 11 | Minigames + Global search (Ctrl+K) | 12s | stills, quick cuts |

- Recording beats: play the clip at real speed inside the frame, caption pinned in a corner. Do not Ken Burns a video clip.
- Still beats: slow Ken Burns push, cross-fade between beats, caption slides in from the right.
- Use `spring()` / `interpolate()`, no CSS transitions. Nothing bounces or spins.
- Two section dividers (~1.5s each, just a word on the brand background) to break the 120s into acts: `מה חדש` before beat 1, `וגם` before beat 4. Without them two minutes of screenshots turns to mush.
- Closing card: live URL `fantasyleagueinfo.onrender.com`, plus the mobile shot to show it works on a phone.

## Constraints

- All work inside `video/` and `docs/demo/`. Do not touch `frontend/` or `backend/` source.
- Put screenshots and clips in `video/public/` (symlink or copy) so Remotion's `staticFile()` and `<OffthreadVideo>` can reach them.
- One `<Composition>`, one scene component per beat, each wrapped in its own `<Sequence>`. Every duration comes from a single `BEATS` array — no hardcoded frame offsets anywhere in the scene components. Changing one beat's length must be a one-number edit, and must not require touching any other beat.
- `<Composition durationInFrames>` must be **computed** as the sum of `BEATS` — never a hardcoded literal. More features land soon (a multi-page draft-prep feature is in flight — it will be captured against the normal dev server, needs no demo overlay, and will slot in beside the other draft-adjacent beats rather than leading); appending beats must extend the video automatically. A hardcoded length truncates the render silently, with no error.

## Voiceover — build the hook, leave it empty

Hebrew voiceover may be recorded later, by a human, per beat. Do not generate TTS and do not record anything now. Just make adding it a drop-in:

- Each entry in `BEATS` carries an optional `audio` filename.
- Each scene renders `<Audio src={staticFile(beat.audio)} />` only when `beat.audio` is set. Missing files must never break the render — the video has to build today with zero audio files present.
- Beat durations are read from `BEATS`, so re-timing a beat to match a recorded take is editing one number.
- Reserve `video/public/vo/` with a `README.md` listing the expected filename per beat (`01-standings-race.mp3`, …) and the Hebrew line to read for each one.

Adding VO later must be: record files → drop into `video/public/vo/` → set `audio` on the beats → adjust durations → re-render. No component rewrites.
- `npm run lint` in `video/` must pass (it runs eslint + tsc).
- Render with `npx remotion render` and confirm the mp4 exists and is ~120s before reporting done.

Show me the beat list and the Hebrew captions before rendering.
