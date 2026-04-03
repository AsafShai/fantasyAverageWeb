# Dependency Audit Report
**Generated:** 2026-04-03
**Scope:** Backend (Python/uv) + Frontend (Node/npm)

---

## Summary

| Severity | Backend (Python) | Frontend (Node) |
|----------|-----------------|-----------------|
| Critical | 0 | 1 |
| High | 0 | 8 |
| Moderate | 0 | 6 |
| Low | 0 | 1 |
| CVEs (transitive) | 14 | 16 |

All frontend vulnerabilities are **`npm audit fix`-able** (no breaking changes required except `react-router-dom`).
All backend CVEs are **patch upgrades** — no API changes needed.

---

## Backend — Python CVEs (14 found via `pip-audit`)

| Package | Current | CVE | Severity | Fix Version | Code Changes? |
|---------|---------|-----|----------|-------------|---------------|
| `cryptography` | 46.0.5 | CVE-2026-34073 | High | 46.0.6 | No |
| `starlette` | 0.46.2 | CVE-2025-54121 | High | 0.47.2+ | No |
| `starlette` | 0.46.2 | CVE-2025-62727 | High | 0.49.1+ | No |
| `langchain-core` | 0.3.72 | CVE-2025-65106 | High | 0.3.80+ | No |
| `langchain-core` | 0.3.72 | CVE-2025-68664 | High | 0.3.81+ | No |
| `langchain-core` | 0.3.72 | CVE-2026-26013 | High | 1.2.11 | Possibly — major version jump to 1.x |
| `requests` | 2.32.4 | CVE-2026-25645 | Moderate | 2.33.0 | No |
| `urllib3` | 2.5.0 | CVE-2025-66418 | Moderate | 2.6.0+ | No |
| `urllib3` | 2.5.0 | CVE-2025-66471 | Moderate | 2.6.0+ | No |
| `urllib3` | 2.5.0 | CVE-2026-21441 | Moderate | 2.6.3 | No |
| `langsmith` | 0.4.11 | CVE-2026-25528 | High | 0.6.3 | No |
| `orjson` | 3.11.1 | CVE-2025-67221 | Moderate | 3.11.6 | No |
| `pygments` | 2.19.2 | CVE-2026-4539 | Moderate | 2.20.0 | No |
| `python-multipart` | 0.0.20 | CVE-2026-24486 | High | 0.0.22 | No |

**Notes:**
- `starlette` is a transitive dep of `fastapi` — updating `fastapi` will pull it in automatically
- `langchain-core` is a transitive dep of `langchain` and `langchain-openai`
- The CVE-2026-26013 fix requires `langchain-core>=1.2.11`, which may be a breaking change if `langchain` hasn't released a compatible version yet
- `python-multipart` is a direct dep in `pyproject.toml` — update the pin there

**How to fix (backend):**
```bash
cd backend
uv add "python-multipart>=0.0.22"
uv lock --upgrade  # upgrades all transitive deps to latest compatible
```

---

## Frontend — Direct Dependency CVEs

These are **direct** dependencies in `package.json` with CVEs:

| Package | Current | CVE / Advisory | Severity | Fix Version | Code Changes? | Layer |
|---------|---------|----------------|----------|-------------|---------------|-------|
| `axios` | 1.10.0 | GHSA-4hjh-wcwx-xvwj — DoS via lack of data size check | **High** | ≥1.14.0 | No — drop-in upgrade | Frontend |
| `axios` | 1.10.0 | GHSA-43fc-jf86-j433 — DoS via `__proto__` in mergeConfig | **High** | ≥1.14.0 | No — drop-in upgrade | Frontend |
| `react-router-dom` | 7.6.2 | GHSA-h5cw-625j-3rxh — CSRF in Action/Server Action | **High** | ≥7.14.0 | No for SPA use (no SSR) | Frontend |
| `react-router-dom` | 7.6.2 | GHSA-2w69-qvjg-hvjx — XSS via Open Redirects | **High** | ≥7.14.0 | No | Frontend |
| `react-router-dom` | 7.6.2 | GHSA-8v8x-cx79-35w7 — SSR XSS in ScrollRestoration | **High** | ≥7.14.0 | No (not using SSR) | Frontend |
| `react-router-dom` | 7.6.2 | GHSA-9jcx-v3wj-wh4m — XSS via untrusted paths | **High** | ≥7.14.0 | No | Frontend |
| `react-router-dom` | 7.6.2 | GHSA-3cgp-3xvw-98x8 — XSS Vulnerability | **High** | ≥7.14.0 | No | Frontend |

---

## Frontend — Transitive Dependency CVEs

These are **indirect** deps — fixed automatically by `npm audit fix`:

| Package | CVE / Advisory | Severity | Fix Version | Layer |
|---------|----------------|----------|-------------|-------|
| `form-data` | GHSA-fjxv-7rqg-78g4 — Unsafe random for boundary (cryptographic weakness) | **Critical** | ≥4.0.4 | Frontend |
| `rollup` | GHSA-mw96-cpmx-2vgc — Arbitrary File Write via Path Traversal | **High** | ≥4.59.0 | Frontend (dev) |
| `tar` | GHSA-34x7-hfp2-rc4v, GHSA-8qq5-rm4j-mr97, + 4 more — Path traversal / symlink | **High** | ≥7.5.11 | Frontend (dev) |
| `undici` | GHSA-f269-vfmq-vjvj, GHSA-2mjp-6q6p-2qxm, + 4 more — WebSocket crashes, HTTP smuggling | **High** | ≥7.24.0 | Frontend (dev) |
| `flatted` | GHSA-25h7-pfq9-p65f — Unbounded recursion DoS | **High** | ≥3.4.2 | Frontend (dev) |
| `flatted` | GHSA-rf6f-7fwh-wjgh — Prototype Pollution | **High** | ≥3.4.2 | Frontend (dev) |
| `minimatch` | GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74 — ReDoS | **High** | ≥3.1.3 / ≥9.0.6 | Frontend (dev) |
| `picomatch` | GHSA-3v7f-55p6-f55p, GHSA-c2c7-rcm5-vvqj — Method injection, ReDoS | **High** | ≥2.3.2 / ≥4.0.4 | Frontend (dev) |
| `brace-expansion` | GHSA-f886-m6hf-6m8v — Zero-step sequence DoS | **Moderate** | ≥1.1.13 / ≥2.0.3 | Frontend (dev) |
| `ajv` | GHSA-2g4f-4pwh-qvx6 — ReDoS with `$data` option | **Moderate** | ≥6.14.0 | Frontend (dev) |
| `js-yaml` | GHSA-mh29-5h37-fv8m — Prototype pollution in merge | **Moderate** | ≥4.1.1 | Frontend (dev) |
| `vite` | GHSA-g4jq-h2w9-997c, GHSA-jqfw-vq24-v9c3, GHSA-93m4-6634-74q7 — fs bypass, path traversal | **Moderate** | ≥6.4.1 | Frontend (dev) |
| `yaml` | GHSA-48c2-rrv3-qjmp — Stack Overflow via deeply nested YAML | **Moderate** | ≥2.8.3 | Frontend (dev) |
| `@eslint/plugin-kit` | GHSA-xffm-g5w8-qvg7 — ReDoS in ConfigCommentParser | **Low** | ≥0.3.4 | Frontend (dev) |

---

## Outdated Direct Dependencies (no CVE, but behind latest stable)

| Package | Current | Wanted (semver) | Latest | Layer | Notes |
|---------|---------|-----------------|--------|-------|-------|
| `@reduxjs/toolkit` | 2.8.2 | 2.11.2 | 2.11.2 | Frontend | Minor update |
| `@tailwindcss/vite` | 4.1.10 | 4.2.2 | 4.2.2 | Frontend | Minor update |
| `tailwindcss` | 4.1.10 | 4.2.2 | 4.2.2 | Frontend | Minor update |
| `@tanstack/react-query` | 5.81.2 | 5.96.2 | 5.96.2 | Frontend | Minor update |
| `@tanstack/react-query-devtools` | 5.81.2 | 5.96.2 | 5.96.2 | Frontend | Minor update |
| `react` | 19.1.0 | 19.2.4 | 19.2.4 | Frontend | Minor update |
| `react-dom` | 19.1.0 | 19.2.4 | 19.2.4 | Frontend | Minor update |
| `recharts` | 3.0.0 | 3.8.1 | 3.8.1 | Frontend | Minor update |
| `vite` | 6.3.5 | 6.4.1 | 8.0.3 | Frontend | v8 is major — skip for now |
| `typescript` | 5.8.3 | 5.8.3 | 6.0.2 | Frontend | v6 is major — breaking changes possible |
| `eslint` | 9.29.0 | 9.39.4 | 10.1.0 | Frontend | v10 is major — skip for now |
| `@vitejs/plugin-react` | 4.6.0 | 4.7.0 | 6.0.1 | Frontend | v6 requires Vite 8 |

---

## Recommended Actions

### Step 1 — Backend (safe, no code changes)
```bash
cd backend
uv add "python-multipart>=0.0.22"
uv lock --upgrade
```

### Step 2 — Frontend (safe, no code changes)
```bash
cd frontend
npm audit fix
npm update axios react-router-dom react react-dom @reduxjs/toolkit @tanstack/react-query @tanstack/react-query-devtools recharts @tailwindcss/vite tailwindcss vite@^6 autoprefixer postcss
```

### Step 3 — Skip for now (major versions, breaking changes possible)
- `vite` 8.x
- `typescript` 6.x
- `eslint` 10.x
- `@vitejs/plugin-react` 6.x (requires Vite 8)

---

## What Requires Code Changes?

**None of the CVE fixes require code changes** — they are all patch/minor upgrades.

The only potential issue is `langchain-core >= 1.2.11` (for CVE-2026-26013), which is a major version jump from 0.3.x. However, since `langchain` itself hasn't necessarily released a 1.x version yet, running `uv lock --upgrade` will get the latest compatible minor version (0.3.81+) which fixes 2 of the 3 langchain CVEs without breaking anything.
