---
name: mobile-check
description: This skill should be used after any frontend layout / CSS / responsive change, when the user asks to "check mobile" / "verify on phone" / "test narrow width", or when a UI change is about to be reported as done. Validates at mobile widths via playwright MCP or prompts manual verification.
---

# Mobile Check

Verify a frontend change works at mobile widths before declaring it done.

## When this applies
- After any CSS / layout change
- Before reporting "UI change complete"
- User asks to verify mobile / responsive behavior

Do NOT apply if:
- Change is backend-only
- User explicitly skips mobile verification

## Steps

1. **Dev server** — ensure `cd frontend && npm run dev` is running (port 5173 by default).

2. **Playwright path** (preferred) — if the playwright MCP is available:
   - Navigate to the affected page
   - `browser_resize` to 375×812 (iPhone SE) and 414×896 (iPhone Plus)
   - `browser_take_screenshot` at each width
   - Check: no horizontal scroll, tap targets ≥ 40px, no clipped text, readable font sizes

3. **Manual path** (fallback) — if no playwright:
   - Tell the user the change is ready to inspect
   - Give the exact URL and suggest Chrome DevTools mobile emulation (`Cmd/Ctrl+Shift+M`)
   - Ask them to verify narrow-width behavior before considering the task done

4. **Report** — what you verified, at which widths, with screenshots (if captured). If you couldn't verify (headless, no playwright), say so explicitly — don't claim "works on mobile" without evidence.

## Red flags to catch
- Horizontal scrollbar at 375px → fixed widths somewhere
- Overlapping buttons → flex/grid not wrapping
- Tiny tap targets → padding too small
- Modals that exceed viewport height → missing max-height / scroll
- Table columns overflowing → needs a mobile card view
