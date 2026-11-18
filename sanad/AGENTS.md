# SANAD architecture
- Preserve the existing TanStack Start file routes and React session context so navigation and simulated candidate data remain consistent.
- Use standard Vite plugins and the Node deployment preset for standalone local execution, with no external branding or telemetry.
- Keep the full logo local and derive the browser icon only from its emblem so independent deployments have no hosted asset dependency.
- Preserve the existing semantic design tokens, Arabic metadata, approval gates and opt-in local camera cleanup.
- The UI was designed in Lovable: change frontend files only to wire data, never to restyle. Guests keep the in-memory demo; signed-in accounts persist through `/api`.
- Backend lives in `src/server` (REST router `src/server/http/api.ts`, mounted by `src/routes/api/$.ts`). Schema changes go in a new entry in `src/server/db/migrations.ts` plus `src/server/db/schema.ts`; never edit a shipped migration.
- Signed-in accounts never see the built-in demo jobs as real results (source 'sanad'); they are for the guest demo only. CV-reader changes that alter stored output must bump `PARSER_VERSION` in `src/server/agents/cv/heuristic.ts` so existing profiles are re-read. No CV-specific logic or data in code; keep the five-CV test passing.
- Only answers the candidate approves may reach a report; drafts never do. The interview room runs in the browser (the live interview agent was removed on request); the server keeps only its schedule and report. See docs/BACKEND.md.
