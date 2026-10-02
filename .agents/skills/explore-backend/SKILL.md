---
name: explore-backend
description: This skill should be used when the user asks to "explore the backend", "map the architecture", "document the backend", "how does X flow work", or is onboarding to unfamiliar parts of backend/app/. Outputs a structured architecture summary.
---

# Explore Backend

Produce a structured summary of the backend architecture.

## When this applies
- User asks to explore or document the backend
- Before a large refactor
- User asks "how does <flow> work" or "where does <X> happen"

Do NOT apply if the question is narrow (use Grep/Read directly) or the answer is likely in AGENTS.md.

## Steps

1. **Map directory structure** — list `backend/app/` (routes, services, models, data providers, builders).
2. **Document routes** — for each file in `routes/`: method, path, params, service called. Mark read vs write.
3. **Document services** — for each file in `services/`: purpose, data sources, return types, caching.
4. **Describe data flow** — ESPN → provider → service → builder → route → JSON; plus where DB fits.
5. **Document DB schema** — from `migrations/*.sql` or via the `postgres` MCP (live schema).
6. **Report** — structured summary; flag anything inconsistent, outdated, or missing.

For the project-specific service map and data-flow context, load [references/service-map.md](references/service-map.md).
