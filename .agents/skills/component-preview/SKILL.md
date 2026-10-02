---
name: component-preview
description: This skill should be used when the user asks to "preview a component", "render X in isolation", or wants to iterate on a React component with custom props. Creates a temporary preview file, starts the dev server if needed, and supports prop iteration.
---

# Component Preview

Render a single React component in isolation with custom props, iterate, clean up.

## When this applies
- User wants to preview a component without the full app context
- User wants to try different prop configurations quickly

## Steps

1. **Get target** — ask which component file; ask for props or use defaults.
2. **Create preview file** at `frontend/src/__preview__/ComponentPreview.tsx`:
   ```tsx
   import { ComponentName } from '../path/to/component';

   const mockData = { /* ... */ };

   export default function ComponentPreview() {
     return (
       <div style={{ padding: 20 }}>
         <h1>Preview: ComponentName</h1>
         <ComponentName prop1="value1" />
       </div>
     );
   }
   ```
3. **Wire up route** if needed — add a `/__preview__` route in the router or a dedicated vite entry.
4. **Start dev server** if not running: `cd frontend && npm run dev`. Report the URL.
5. **Iterate** — update props or mock data; support multiple components; add Router / Theme / Query providers if the component needs them.
6. **Cleanup** — ask if the preview file should be kept or deleted when done.

## Tips
- Support mobile/tablet/desktop by resizing the browser
- Use the playwright MCP for automated snapshots across widths
- If the component consumes TanStack Query, wrap in a `QueryClientProvider` with a mock client
