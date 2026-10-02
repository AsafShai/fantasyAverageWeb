/* Capture interaction clips + stills for the demo video.

   Prereqs (see scripts/demo_api/server.py docstring):
     - backend :8000, demo proxy :8010, vite --mode demo on :5173

   Output:
     docs/demo/shots/*.png
     docs/demo/clips/*.webm

   Run: node capture.js              (everything)
        node capture.js 04-trends    (single clip by key)
*/
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");

const BASE = process.env.DEMO_BASE || "http://localhost:5173";
const SHOTS = path.join(__dirname, "..", "shots");
const CLIPS = path.join(__dirname, "..", "clips");
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(CLIPS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const park = async (page, x = 960, y = 540) => { await page.mouse.move(x, y); await sleep(250); };

// Playwright records the page, not the OS pointer. Inject a synthetic cursor
// that follows mouse events and flashes on click so viewers see what was hit.
const CURSOR_SCRIPT = `
(() => {
  const add = () => {
    if (document.getElementById("__demo_cursor")) return;
    const dot = document.createElement("div");
    dot.id = "__demo_cursor";
    dot.style.cssText = [
      "position:fixed","z-index:2147483647","pointer-events:none",
      "width:26px","height:26px","margin:-13px 0 0 -13px","border-radius:50%",
      "background:rgba(252,163,17,0.55)","border:2px solid #14213D",
      "box-shadow:0 2px 10px rgba(0,0,0,0.45)","left:-100px","top:-100px",
    ].join(";");
    document.body.appendChild(dot);

    const ring = document.createElement("div");
    ring.id = "__demo_cursor_ring";
    ring.style.cssText = [
      "position:fixed","z-index:2147483646","pointer-events:none",
      "width:26px","height:26px","margin:-13px 0 0 -13px","border-radius:50%",
      "border:3px solid #FCA311","opacity:0","left:-100px","top:-100px",
      "transition:none",
    ].join(";");
    document.body.appendChild(ring);

    let rx = -100, ry = -100;
    addEventListener("mousemove", (e) => {
      rx = e.clientX; ry = e.clientY;
      dot.style.left = rx + "px"; dot.style.top = ry + "px";
    }, true);

    addEventListener("mousedown", () => {
      ring.style.left = rx + "px"; ring.style.top = ry + "px";
      ring.style.opacity = "1";
      ring.style.scale = "1";
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 420);
        ring.style.scale = String(1 + k * 1.6);
        ring.style.opacity = String(1 - k);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, true);
  };
  if (document.body) add();
  else addEventListener("DOMContentLoaded", add);
})();
`;


async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, name) });
  console.log(`  still  ${name}`);
}

// recordVideo writes one webm per context; rename it after closing.
async function finishVideo(ctx, page, name) {
  const video = page.video();
  await ctx.close();
  const p = await video.path();
  fs.renameSync(p, path.join(CLIPS, name));
  console.log(`  clip   ${name}`);
}

async function newRecordingCtx(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: CLIPS, size: { width: 1920, height: 1080 } },
  });
  await ctx.addInitScript(CURSOR_SCRIPT);
  return ctx;
}

// Slow, deliberate drag across an <input type=range>.
async function dragSlider(page, slider, fromRatio, toRatio, steps, msPerStep) {
  const box = await slider.boundingBox();
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width * fromRatio;
  const x1 = box.x + box.width * toRatio;
  await slider.scrollIntoViewIfNeeded();
  await sleep(400);
  await page.mouse.move(x0, y);
  await sleep(300);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y);
    await sleep(msPerStep);
  }
  await sleep(400);
  await page.mouse.up();
}


// Hover first so the injected cursor travels to the target, then click.
async function showClick(page, locator, dwell = 650) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.hover({ timeout: 20000 }).catch(() => {});
  await sleep(dwell);
  await locator.click({ timeout: 30000 });
}

/* ---------- clips ---------- */

// One slider drag (rows reorder live) + Ranked/Raw header toggle.
async function playerRankings(browser) {
  console.log("player rankings");
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/player-rankings`, { waitUntil: "domcontentloaded" });
  await page.locator("tbody tr").first().waitFor({ timeout: 180000 });
  await sleep(2000);
  await shot(page, "20-player-rankings.png");

  await dragSlider(page, page.locator('input[type="range"]').first(), 0.5, 0.95, 28, 75);
  await sleep(2000); // rows reorder once the debounced commit lands

  await showClick(page, page.getByRole("button").filter({ hasText: /^PTS$/ }));
  await sleep(3000);
  await showClick(page, page.getByRole("button").filter({ hasText: /^PTS_z/ }));
  await sleep(3200);

  await finishVideo(ctx, page, "02-player-rankings.webm");
}

// Row -> chart expand on Minutes Movers, then two tab switches.
// One clip per Trends tab, each with a row expanded so the chart is on screen.
async function trendsTab(browser, { tab, file, still }) {
  console.log(`trends: ${tab}`);
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/trends`, { waitUntil: "domcontentloaded" });
  await page.locator("tbody tr[role='button']").first().waitFor({ timeout: 180000 });
  await park(page);
  await sleep(2000);

  if (tab) {
    await showClick(page, page.getByRole("button", { name: tab }));
    await page.locator("tbody tr[role='button']").first().waitFor({ timeout: 120000 });
    await sleep(3000);
  }

  await showClick(page, page.locator("tbody tr[role='button']").first());
  await sleep(4500); // chart expands under the row

  const chart = page.locator(".recharts-wrapper").first();
  await chart.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(3200);
  if (still) await shot(page, still);

  await page.mouse.wheel(0, 160);
  await sleep(2600);

  await finishVideo(ctx, page, file);
}

const trendsMinutes = (b) =>
  trendsTab(b, { tab: null, file: "04-trends-minutes.webm", still: "10-trends-minutes.png" });
const trendsUsage = (b) =>
  trendsTab(b, { tab: "Usage & Role", file: "04b-trends-usage.webm", still: "11-trends-usage.png" });
const trendsShooting = (b) =>
  trendsTab(b, { tab: "Shooting · Season", file: "04c-trends-shooting.webm", still: "12-trends-shooting.png" });

async function projections(browser) {
  console.log("projections minutes drag");
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/projections`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="range"]').first().waitFor({ timeout: 180000 });
  await sleep(1500);
  await shot(page, "21-projections.png");

  await dragSlider(page, page.locator('input[type="range"]').first(), 0.55, 0.9, 26, 80);
  await sleep(2200);
  await dragSlider(page, page.locator('input[type="range"]').first(), 0.9, 0.25, 30, 70);
  await sleep(2200);

  await finishVideo(ctx, page, "05-projections.webm");
}

// Expand the matchup detail row on the players table.
async function matchup(browser) {
  console.log("matchup expand");
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/players`, { waitUntil: "domcontentloaded" });
  await page.locator("tbody tr").first().waitFor({ timeout: 180000 });
  await sleep(1500);
  await shot(page, "02-players.png");

  // Rows whose matchup cell is "—" have no game tonight and do not expand.
  const withMatchup = page.locator('tbody tr:has(td:last-child:has-text("vs "))').first();
  await withMatchup.waitFor({ timeout: 60000 });
  await showClick(page, withMatchup.locator("td:last-child"));
  await sleep(2500); // expanded defense-rank row appears

  // The table scrolls internally, so wheel() moves rows; scroll the window.
  await page.evaluate(() => window.scrollBy({ top: 430, behavior: "smooth" }));
  await sleep(3000);
  await shot(page, "03-players-matchup-expanded.png");

  await finishVideo(ctx, page, "06-matchup.webm");
}

// Open a player page from the players table, scroll through charts.
async function playerPage(browser) {
  console.log("player page");
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/players`, { waitUntil: "domcontentloaded" });
  await page.locator("tbody tr").first().waitFor({ timeout: 180000 });

  await Promise.all([
    page.waitForURL(/\/player\//, { timeout: 60000 }),
    page.locator("tbody tr").first().locator("a").first().click(),
  ]);
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await sleep(2000);

  for (const dy of [350, 350, 350]) {
    await page.mouse.wheel(0, dy);
    await sleep(1100);
  }
  await sleep(800);

  await finishVideo(ctx, page, "07-player-page.webm");
}

// Open the custom date range picker and apply a window.
// The overlay presents the season as 2026-27 while the picker validates
// against the real system clock, so run the page inside a shifted clock.
async function customRange(browser) {
  console.log("custom range");
  // The demo backend needs ~25s the first time a custom window is requested.
  // Warm it before recording, so the clip shows a fast Apply, not a spinner.
  const api = process.env.DEMO_API || "http://localhost:8010/api";
  console.log("  warming custom-range query...");
  await fetch(`${api}/players?page=1&limit=1200&time_period=custom&start=2026-11-01&end=2026-11-20`)
    .then((r) => r.text())
    .catch(() => {});

  const ctx = await newRecordingCtx(browser);
  await ctx.clock.install({ time: new Date("2026-12-01T12:00:00") });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/players`, { waitUntil: "domcontentloaded" });
  await page.locator("tbody tr").first().waitFor({ timeout: 180000 });
  await sleep(1200);

  await showClick(page, page.getByRole("button", { name: /Custom/ }));
  await page.locator('input[type="date"]').first().waitFor({ timeout: 30000 });
  await sleep(1000);
  await page.locator('input[type="date"]').nth(0).fill("2026-11-01");
  await sleep(700);
  await page.locator('input[type="date"]').nth(1).fill("2026-11-20");
  await sleep(900);
  await shot(page, "04-players-custom-range.png");
  await showClick(page, page.getByRole("button", { name: "Apply" }));
  // Wait for the refetch to actually settle — ending on the spinner made the
  // beat finish on a "Loading..." frame.
  // The table keeps rendering the previous (season) response while the custom
  // window is in flight, so wait for the stale coverage notice to clear.
  await page
    .locator("text=we only have box scores")
    .first()
    .waitFor({ state: "hidden", timeout: 90000 })
    .catch(() => {});
  await sleep(4500);

  await finishVideo(ctx, page, "08-custom-range.webm");
}

// Ctrl+K -> type -> arrow -> Enter lands on a player page.
async function globalSearch(browser) {
  console.log("global search");
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await sleep(1500);

  await page.keyboard.press("Control+k");
  await page.locator('input[placeholder*="Search"]').waitFor({ timeout: 15000 });
  await sleep(900);
  await page.keyboard.type("wemba", { delay: 140 });
  await sleep(1600); // suggestions populate
  await shot(page, "60-global-search.png");
  await page.keyboard.press("ArrowDown");
  await sleep(700);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/player\//, { timeout: 30000 }).catch(() => {});
  await sleep(1800);

  await finishVideo(ctx, page, "09-search.webm");
}

// Minigames hub -> Hangman -> a couple of deliberate letter guesses.
async function minigames(browser) {
  console.log("minigames hangman");
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/minigames`, { waitUntil: "domcontentloaded" });
  await page.locator("text=Hangman").first().waitFor({ timeout: 60000 });
  await park(page);
  await sleep(2600);

  await showClick(page, page.locator("a", { hasText: "Hangman" }).first());
  await page.waitForURL(/hangman/, { timeout: 30000 });
  await sleep(2400);

  // Without this the board stays idle and every letter click is a no-op.
  await showClick(page, page.getByRole("button", { name: /Start New Game/i }));
  await sleep(2600);

  for (const letter of ["A", "E", "O", "R", "N"]) {
    const key = page.getByRole("button", { name: letter, exact: true }).first();
    if (await key.count()) {
      await showClick(page, key, 450);
      await sleep(1500);
    }
  }
  await sleep(2200);

  await finishVideo(ctx, page, "10-minigames.webm");
}

/* ---------- stills ---------- */

// Slot usage section of a team page, centered in frame.
async function slotUsage(browser) {
  console.log("slot usage");
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();

  let found = false;
  for (const id of [1, 2, 3, 4, 5, 6]) {
    await page.goto(`${BASE}/team/${id}`, { waitUntil: "domcontentloaded" });
    try {
      await page.locator("h2", { hasText: "Slot usage" }).waitFor({ timeout: 15000 });
      found = true;
      break;
    } catch {
      console.log(`  no slot usage on /team/${id}, trying next`);
    }
  }
  if (!found) throw new Error("slot usage table not found on any team page");

  const h2 = page.locator("h2", { hasText: "Slot usage" });
  await h2.scrollIntoViewIfNeeded();
  const hb = await h2.boundingBox();
  if (hb) {
    // Park the table low in the viewport so Roster coverage stays below the
    // fold — it is a different feature and confuses the slot-usage beat.
    await page.evaluate((delta) => window.scrollBy(0, delta), hb.y - 430);
  }
  await sleep(2500);
  await shot(page, "50-team-slots.png");

  // Trace the three columns instead of scrolling — scrolling drifts into
  // Roster coverage, which is a different feature and reads as confusing.
  for (const label of ["Used", "Projected", "Max"]) {
    const head = page.locator("th", { hasText: new RegExp(`^${label}$`, "i") }).first();
    if (await head.count()) {
      await head.hover().catch(() => {});
      await sleep(2600);
    }
  }
  const rows = page.locator("tbody tr");
  for (const i of [0, 2, 4]) {
    await rows.nth(i).hover().catch(() => {});
    await sleep(1600);
  }
  await sleep(1200);

  await finishVideo(ctx, page, "03-slot-usage.webm");
}

// Season schedule page: months heatmap -> weeks grain -> back.
async function scheduleSeason(browser) {
  console.log("season schedule");
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/schedule`, { waitUntil: "domcontentloaded" });
  await page.locator("tbody tr").first().waitFor({ timeout: 180000 });
  await sleep(2200);
  await shot(page, "80-schedule-season.png");

  // The grain toggle drives a heatmap far below the calendar; bring the table
  // into frame first or the click reads as a no-op on screen.
  const grain = page.getByRole("button", { name: "weeks", exact: true });
  await grain.scrollIntoViewIfNeeded();
  const gb = await grain.boundingBox();
  if (gb) await page.evaluate((d) => window.scrollBy(0, d), Math.max(0, gb.y - 220));
  await sleep(1800);
  await shot(page, "81-schedule-months-table.png");

  await showClick(page, grain);
  await sleep(4000);
  await shot(page, "82-schedule-weeks-table.png");

  await page.mouse.wheel(0, 260);
  await sleep(1400);
  await showClick(page, page.getByRole("button", { name: "months", exact: true }));
  await sleep(3000);

  await finishVideo(ctx, page, "11-schedule-season.webm");
}

// Roster coverage on a fantasy team page: day bars, 14 -> 28 day horizon.
async function rosterCoverage(browser) {
  console.log("roster coverage");
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();

  let found = false;
  for (const id of [1, 2, 3, 4, 5, 6]) {
    await page.goto(`${BASE}/team/${id}`, { waitUntil: "domcontentloaded" });
    try {
      await page.locator("h2", { hasText: "Roster coverage" }).waitFor({ timeout: 20000 });
      found = true;
      break;
    } catch {
      console.log(`  no roster coverage on /team/${id}, trying next`);
    }
  }
  if (!found) throw new Error("roster coverage not found on any team page");

  const h2 = page.locator("h2", { hasText: "Roster coverage" });
  await h2.scrollIntoViewIfNeeded();
  const hb = await h2.boundingBox();
  if (hb) await page.evaluate((d) => window.scrollBy(0, d), Math.max(0, hb.y - 80));
  await sleep(2200);
  await shot(page, "83-roster-coverage.png");

  const days = page.locator('button[aria-pressed]');
  for (const i of [2, 5, 8]) {
    await showClick(page, days.nth(i), 500).catch(() => {});
    await sleep(2200);
  }

  await showClick(page, page.getByRole("button", { name: "28 days" }));
  await sleep(3800);

  await finishVideo(ctx, page, "12-roster-coverage.webm");
}

// NBA Teams page: pick a team, its 82-game schedule view underneath.
async function nbaTeamSchedule(browser) {
  console.log("nba team schedule");
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/nba-teams`, { waitUntil: "domcontentloaded" });
  const picker = page.locator("select").first();
  await picker.waitFor({ timeout: 180000 });
  await park(page);
  await sleep(1800);

  // Nothing renders until a team is chosen.
  const teamValue = await picker.locator("option").nth(1).getAttribute("value");
  await picker.selectOption(teamValue);
  await sleep(3200);

  const heading = page.locator("h2", { hasText: /schedule$/ });
  await heading.first().waitFor({ timeout: 60000 });
  await heading.first().scrollIntoViewIfNeeded();
  const hb = await heading.first().boundingBox();
  if (hb) await page.evaluate((d) => window.scrollBy(0, d), Math.max(0, hb.y - 120));
  await sleep(2600);
  await shot(page, "84-nba-team-schedule.png");

  await page.mouse.wheel(0, 320);
  await sleep(2400);
  await page.mouse.wheel(0, 320);
  await sleep(2600);

  await finishVideo(ctx, page, "13-nba-team-schedule.webm");
}

// Players page: the schedule-driven "only players who play tonight" filter.
async function playersSlateFilter(browser) {
  console.log("players slate filter");
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/players`, { waitUntil: "domcontentloaded" });
  await page.locator("tbody tr").first().waitFor({ timeout: 180000 });
  await park(page);
  await sleep(2400);

  const toggle = page.locator('label[title*="plays on the selected slate"]');
  await showClick(page, toggle.first(), 900);
  await sleep(4000); // table filters down to tonight's slate
  await shot(page, "85-players-slate-filter.png");

  await showClick(page, toggle.first(), 900);
  await sleep(3000);

  await finishVideo(ctx, page, "14-players-slate-filter.webm");
}

// One still per minigame for the closing montage.
async function minigameShots(browser) {
  console.log("minigame stills");
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();
  const games = [
    ["who-am-i", "31-minigame-who-am-i.png"],
    ["now-you-see-me", "32-minigame-now-you-see-me.png"],
    ["hangman", "33-minigame-hangman.png"],
    ["who-he-play-for", "34-minigame-who-he-play-for.png"],
  ];
  await page.goto(`${BASE}/minigames`, { waitUntil: "domcontentloaded" });
  await page.locator("text=Hangman").first().waitFor({ timeout: 120000 });
  await sleep(1500);
  await shot(page, "30-minigames-hub.png");

  for (const [slug, file] of games) {
    await page.goto(`${BASE}/minigames/${slug}`, { waitUntil: "domcontentloaded" });
    await sleep(3000);
    const start = page.getByRole("button", { name: /Start New Game/i });
    if (await start.count()) {
      await start.first().click().catch(() => {});
      await sleep(2600);
    }
    await shot(page, file);
  }

  await finishVideo(ctx, page, "15-minigame-shots.webm");
}

// Per-day slate view: games-per-night bars + the "Who plays when" grid.
async function scheduleSlate(browser) {
  console.log("schedule slate calendar");
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/schedule`, { waitUntil: "domcontentloaded" });
  await page.locator("text=Games per night").first().waitFor({ timeout: 180000 });
  await park(page);
  await sleep(1600);
  await shot(page, "86-schedule-slate.png");

  // Each bar is a night; clicking one lists that night's games underneath.
  const nights = page.locator('button[aria-pressed]');
  for (const i of [3, 6, 9]) {
    await showClick(page, nights.nth(i), 350);
    await sleep(1500);
  }

  const grid = page.locator("h2", { hasText: "Who plays when" });
  await grid.scrollIntoViewIfNeeded();
  const gb = await grid.boundingBox();
  if (gb) await page.evaluate((d) => window.scrollBy(0, d - 90), gb.y);
  await sleep(1800);
  await shot(page, "87-schedule-who-plays-when.png");

  const teamCell = page.locator("tbody th, tbody td:first-child").first();
  await showClick(page, teamCell, 400).catch(() => {});
  await sleep(2200);

  await finishVideo(ctx, page, "16-schedule-slate.webm");
}

// Slow vertical drag on a dnd-kit handle (PointerSensor, 8px activation).
async function dragRow(page, handle, dy, steps = 24, msPerStep = 55) {
  await handle.scrollIntoViewIfNeeded().catch(() => {});
  const box = await handle.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await sleep(500);
  await page.mouse.down();
  await page.mouse.move(x, y + 10);
  await sleep(250);
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x, y + 10 + (dy * i) / steps);
    await sleep(msPerStep);
  }
  await sleep(600);
  await page.mouse.up();
}

// One page, two views: published rankings and ADP, blended across sites.
async function draftAdp(browser) {
  console.log("draft adp");
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/draft/rankings-adp`, { waitUntil: "domcontentloaded" });
  await page.locator("tbody tr").first().waitFor({ timeout: 180000 });
  await park(page);
  await sleep(2000);
  await shot(page, "88-draft-adp.png");

  // Uncheck a site: its column disappears and Blend recomputes from the rest.
  const sleeper = page.locator("label", { hasText: "Sleeper" }).locator('input[type="checkbox"]');
  await showClick(page, sleeper, 450);
  await sleep(2200);
  await showClick(page, sleeper, 400);
  await sleep(1800);

  for (const dy of [640, 640]) {
    await page.evaluate((d) => window.scrollBy({ top: d, behavior: "smooth" }), dy);
    await sleep(1500);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(1400);

  // Rankings and ADP are different scales, so they are separate views of the
  // same table; Fantrax publishes ADP only and appears in this one.
  await showClick(page, page.getByRole("button", { name: "ADP", exact: true }).first(), 450);
  await page.locator("tbody tr").first().waitFor({ timeout: 60000 });
  await sleep(3200);
  await shot(page, "94-draft-adp-view.png");

  await page.evaluate(() => window.scrollBy({ top: 620, behavior: "smooth" }));
  await sleep(1800);

  await finishVideo(ctx, page, "17-draft-adp.webm");
}

// Personal board: drag a player up, then jump one to an exact rank.
async function draftRankings(browser) {
  console.log("draft rankings");
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/draft/rankings`, { waitUntil: "domcontentloaded" });
  await page.locator('[aria-label^="Drag "]').first().waitFor({ timeout: 180000 });
  await park(page);
  await sleep(2200);
  await shot(page, "90-draft-rankings.png");

  const handles = page.locator('[aria-label^="Drag "]');
  await dragRow(page, handles.nth(5), -190);
  await sleep(2600);

  // Move to: type an exact rank instead of dragging across pages.
  await showClick(page, page.getByRole("button", { name: "Move to" }).nth(2), 550);
  await page.getByRole("dialog").waitFor({ timeout: 30000 });
  await sleep(1600);
  const rankInput = page.getByRole("dialog").locator('input[type="number"]');
  await rankInput.fill("");
  await rankInput.type("18", { delay: 220 });
  await sleep(2400); // "Nearby after move" preview settles
  await showClick(page, page.getByRole("button", { name: "Confirm move" }), 500);
  await sleep(3000);
  await shot(page, "91-draft-rankings-moved.png");

  // Brief look further down the board, then back to the top.
  await page.evaluate(() => window.scrollBy({ top: 700, behavior: "smooth" }));
  await sleep(1600);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(1400);

  await finishVideo(ctx, page, "18-draft-rankings.webm");
}

// The board travels as a CSV: export it, then import one back over the order.
async function draftRankingsCsv(browser) {
  console.log("draft rankings csv");
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/draft/rankings`, { waitUntil: "domcontentloaded" });
  await page.locator('[aria-label^="Drag "]').first().waitFor({ timeout: 180000 });
  await park(page);
  await sleep(2000);

  const csvPath = path.join(os.tmpdir(), "pre-draft-rankings-demo.csv");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    showClick(page, page.getByRole("button", { name: "Export CSV" }).first(), 700),
  ]);
  await download.saveAs(csvPath);
  await sleep(2400);

  const handles = page.locator('[aria-label^="Drag "]');
  await dragRow(page, handles.nth(4), -150);
  await sleep(2400);

  // Import the file exported a moment ago, putting that order back.
  await showClick(page, page.getByRole("button", { name: "Import CSV" }).first(), 700);
  await page.setInputFiles('input[type="file"]', csvPath);
  await page.getByRole("dialog", { name: /Replace current order/ }).waitFor({ timeout: 30000 });
  await sleep(3000);
  await showClick(page, page.getByRole("button", { name: "Replace order" }), 550);
  await sleep(3200);
  await shot(page, "96-draft-rankings-imported.png");

  await finishVideo(ctx, page, "18b-draft-rankings-csv.webm");
}

// Board is laid out from Blend ADP, not from the personal rankings.
async function draftBoard(browser) {
  console.log("draft board");
  const ctx = await newRecordingCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/draft/board`, { waitUntil: "domcontentloaded" });
  await page.locator("text=Round 1").first().waitFor({ timeout: 180000 });
  await park(page);
  await sleep(2400);
  await shot(page, "92-draft-board.png");

  await showClick(page, page.getByRole("button", { name: "Manage league settings" }), 550);
  await page.getByRole("dialog").waitFor({ timeout: 30000 });
  await sleep(1500);
  for (let i = 0; i < 2; i++) {
    await showClick(page, page.getByRole("button", { name: "Increase League size" }), 350);
    await sleep(500);
  }
  // 3RR: rounds 2 and 3 both run last-to-first, which shifts every later pick.
  const threeRr = page.getByRole("dialog").getByRole("button", { name: "Yes", exact: true });
  await showClick(page, threeRr, 450);
  await sleep(1400);
  await showClick(page, page.getByRole("dialog").getByRole("button", { name: "Save" }), 500);
  await sleep(2600);

  await page.evaluate(() => window.scrollBy({ top: 520, behavior: "smooth" }));
  await sleep(2600);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(1400);

  // Same picks regrouped into each team's roster.
  await showClick(page, page.getByRole("button", { name: "Team", exact: true }), 500);
  await sleep(3000);
  await shot(page, "93-draft-board-by-team.png");
  await page.evaluate(() => window.scrollBy({ top: 480, behavior: "smooth" }));
  await sleep(2800);

  await finishVideo(ctx, page, "19-draft-board.webm");
}

// One continuous mock-draft take: settings, the room, search, the queue, two
// picks, then history and the board. Played as a single beat, so it must hold
// together without cuts — no dead waiting on a bot clock.
async function mockDraft(browser, { statsFrom = "projection", file = "20-mock-draft.webm" } = {}) {
  console.log(`mock draft (${statsFrom})`);
  const ctx = await newRecordingCtx(browser);
  const t0 = Date.now();
  const mark = (label) => console.log(`  mark   ${((Date.now() - t0) / 1000).toFixed(1)}s  ${label}`);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/draft/mock`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Start Mock Draft" }).waitFor({ timeout: 180000 });
  await park(page);
  await sleep(1500);
  mark("setup");
  await shot(page, "97-mock-setup.png");

  await showClick(page, page.getByRole("button", { name: "Increase Your first-round pick" }), 400);
  await sleep(350);
  await showClick(page, page.getByRole("button", { name: "Increase Your first-round pick" }), 300);
  await sleep(1000);
  await showClick(page, page.getByRole("button", { name: "Timed", exact: true }), 420);
  await sleep(900);
  const botSecDown = page.getByRole("button", { name: "Decrease Seconds between bot picks" });
  await showClick(page, botSecDown, 380);
  await sleep(600);
  await showClick(page, botSecDown, 300);
  await sleep(900);
  // 60s on our clock: long enough that the take never stalls waiting on it.
  await showClick(page, page.getByRole("button", { name: "60 seconds" }), 420);
  await sleep(1200);
  mark("settings done");

  await showClick(page, page.getByRole("button", { name: "Start Mock Draft" }), 550);
  await page.getByRole("button", { name: "Leave Draft Room" }).first().waitFor({ timeout: 60000 });
  await sleep(2000);
  if (statsFrom === "actual") {
    // ESPN has not published 2026-27 projections, so those columns are all
    // dashes; last season's numbers fill them in.
    const stats = page.locator('select:visible').filter({ hasText: "Last year" }).first();
    await stats.selectOption("actual");
    await sleep(1500);
  }
  // Only the first 80 rows are hydrated with stats, and a search collapses that
  // window; wait for real numbers back on screen before filming the table.
  const waitForStats = async (label) => {
    for (let i = 0; i < 16; i++) {
      const filled = await page.evaluate(() => {
        const table = [...document.querySelectorAll("table")].find((t) =>
          (t.querySelector("thead")?.textContent || "").startsWith("Rk"),
        );
        if (!table) return 0;
        return [...table.querySelectorAll("tbody tr")].slice(0, 12).filter((row) =>
          [...row.querySelectorAll("td")].slice(3).some((td) => {
            const text = td.textContent.trim();
            return text && text !== "—";
          }),
        ).length;
      });
      if (filled >= 8) {
        console.log(`  stats  ${label}: ${filled}/12 rows`);
        return;
      }
      await sleep(500);
    }
    console.log(`  stats  ${label}: still empty`);
  };
  if (statsFrom === "actual") await waitForStats("room");
  await sleep(1500);
  mark("room open");
  await shot(page, statsFrom === "actual" ? "102-mock-room-lastyear.png" : "98-mock-room.png");

  const search = page.getByPlaceholder("Search players").first();
  const queue = async (name) => {
    await search.click();
    await search.fill(name);
    await sleep(1400);
    await showClick(page, page.locator('[aria-label^="Add "]').first(), 420);
    await sleep(1100);
    await search.fill("");
    await sleep(600);
  };
  await queue("Sabonis");
  mark("queued first");
  await queue("Herro");
  await queue("Bane");
  mark("queue built");

  // One sim is enough to show the control; the rest of the bot picks are worth
  // watching at 1s apart.
  const simTo = async () => {
    const sim = page.locator('button:visible:has-text("Sim to my pick")');
    if (await sim.count()) {
      await showClick(page, sim.first(), 450);
      await sleep(1500);
    }
  };
  const onClock = () => page.getByText("on the clock", { exact: false }).first().waitFor({ timeout: 60000 });

  await onClock();
  await sleep(1500);
  mark("on the clock");
  await shot(page, "99-mock-on-the-clock.png");

  // Pick one: straight off the queue from the header.
  const queueDraft = page.getByRole("button", { name: /^Draft [A-Z]/ }).first();
  if (await queueDraft.count()) await showClick(page, queueDraft, 650);
  else await showClick(page, page.getByRole("button", { name: "Draft", exact: true }).first(), 650);
  await sleep(2600);
  mark("queue pick");

  // Pick two: search someone who is not queued and draft them off the row.
  await sleep(4000); // bots run the rest of the round in the ticker
  await simTo();
  await onClock();
  await sleep(1000);
  // Bots may have taken the target already; fall back down a short list.
  let drafted = false;
  for (const name of ["Mobley", "Kessler", "Avdija", "Murphy"]) {
    await search.click();
    await search.fill(name);
    await sleep(1500);
    const btn = page.getByRole("button", { name: "Draft", exact: true }).first();
    if (await btn.isEnabled().catch(() => false)) {
      await showClick(page, btn, 600);
      drafted = true;
      break;
    }
  }
  if (!drafted) {
    await search.fill("");
    await sleep(1200);
    await showClick(page, page.getByRole("button", { name: "Draft", exact: true }).first(), 600);
  }
  await sleep(1600);
  await search.fill("");
  await sleep(1500);
  if (statsFrom === "actual") await waitForStats("after search");
  await sleep(1500);
  mark("searched pick");

  await showClick(page, page.getByRole("button", { name: "Pick history" }), 500);
  await sleep(3000);
  await shot(page, "100-mock-history.png");
  mark("history");

  await showClick(page, page.getByRole("button", { name: "Draft board" }), 500);
  await sleep(2600);
  await showClick(page, page.locator('button:visible', { hasText: /^Team$/ }).first(), 450);
  await sleep(2800);
  await shot(page, "101-mock-board.png");
  await page.evaluate(() => window.scrollBy({ top: 420, behavior: "smooth" }));
  await sleep(2200);
  mark("end");

  await finishVideo(ctx, page, file);
}

const CLIPS_BY_KEY = {
  "02-player-rankings": playerRankings,
  "03-slot-usage": slotUsage,
  "04-trends-minutes": trendsMinutes,
  "04b-trends-usage": trendsUsage,
  "04c-trends-shooting": trendsShooting,
  "05-projections": projections,
  "06-matchup": matchup,
  "07-player-page": playerPage,
  "08-custom-range": customRange,
  "09-search": globalSearch,
  "10-minigames": minigames,
  "11-schedule-season": scheduleSeason,
  "12-roster-coverage": rosterCoverage,
  "13-nba-team-schedule": nbaTeamSchedule,
  "14-players-slate-filter": playersSlateFilter,
  "15-minigame-shots": minigameShots,
  "16-schedule-slate": scheduleSlate,
  "17-draft-adp": draftAdp,
  "18-draft-rankings": draftRankings,
  "18b-draft-rankings-csv": draftRankingsCsv,
  "19-draft-board": draftBoard,
  "20-mock-draft": mockDraft,
  "21-mock-draft-lastyear": (b) => mockDraft(b, { statsFrom: "actual", file: "21-mock-draft-lastyear.webm" }),
};

(async () => {
  const only = process.argv.slice(2);
  const keys = only.length ? only : Object.keys(CLIPS_BY_KEY);
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const k of keys) {
      const fn = CLIPS_BY_KEY[k];
      if (!fn) throw new Error(`unknown clip key: ${k}`);
      await fn(browser);
    }
    console.log("done");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
