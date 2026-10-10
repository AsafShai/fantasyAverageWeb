# ESPN Pre-Draft Rankings helper (Chrome)

Unofficial Chrome extension. It reorders players on ESPN’s **Edit Draft Strategy** page from our Pre-Draft Rankings list. It **does not** click **Save Rankings** and **does not** call ESPN write APIs.

ESPN’s terms disallow automated access. Use at your own risk.

## Install (unpacked)

1. In this folder run `npm install` then `npm run build`.
2. Chrome → `chrome://extensions` → enable **Developer mode**.
3. **Load unpacked** → select `extension/dist`.
4. Reload our Pre-Draft Rankings page and ESPN’s Edit Draft Strategy tab.

## Use

1. On `/draft/rankings`, order players, then **Apply on ESPN** (or **Export CSV** and load that file in the extension).
2. Open your league’s Edit Draft Strategy page, for example `https://fantasy.espn.com/basketball/editdraftstrategy?leagueId=…`.
3. In the helper panel click **Apply order**. It reorders ESPN’s list in one step (`espn-instant`, about a second). If ESPN’s page has changed and that fails, it falls back to row-by-row drags (`espn-drags`, minutes), clicking **Show more** as needed. Rank numbers must change and **Save Rankings** should enable — if they do not, do not save.
4. Click ESPN’s **Save Rankings** yourself. If you refresh without saving, ESPN restores the last saved order.

## Notes

- Matching uses ESPN player id first, then name + team.
- Players on ESPN that are not in our export stay at the bottom in their current relative order.
- After rebuilding, click **Reload** on `chrome://extensions` for this helper, then refresh the ESPN tab.
- ESPN UI changes can break in-page reorder. If Apply cannot update ranks, do not save.

## Offline end-to-end test

`e2e/` runs the built extension against a local stand-in for ESPN’s rankings page (React 16 + MobX 4 strict mode, same store fields as ESPN’s bundle). All network requests are blocked, so it never contacts ESPN.

```
cd e2e && npm install && npx playwright install chromium && npm test
```
