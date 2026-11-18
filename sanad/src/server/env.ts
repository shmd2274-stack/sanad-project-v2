import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Server-only configuration. Nothing here is exposed to the browser.
 * Every value has a safe local default so `npm run dev` works with no setup.
 * `.env.local` then `.env` are read for both `npm run dev` and `npm start`; real environment variables win.
 */
for (const file of ['.env.local', '.env']) {
  try {
    const values = parseEnv(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'));
    for (const [key, value] of Object.entries(values)) if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
  } catch { /* file not present */ }
}

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export const env = {
  /** Production PostgreSQL (Supabase, Neon, RDS, ...). When unset an embedded PostgreSQL (PGlite) is used. */
  databaseUrl: read('DATABASE_URL'),
  /** Where the embedded PostgreSQL keeps its files. `memory://` keeps it in RAM (tests). */
  pgliteDir: read('PGLITE_DIR') ?? path.resolve(process.cwd(), '.data', 'pglite'),
  /** Claude powers the CV and jobs agents. Without it the CV agent uses its offline reader. */
  anthropicEnabled: Boolean(read('ANTHROPIC_API_KEY') || read('ANTHROPIC_AUTH_TOKEN')) && read('SANAD_DISABLE_LLM') !== '1',
  anthropicModel: read('SANAD_CLAUDE_MODEL') ?? 'claude-opus-5-5',
  /** How often the jobs agent searches for new deaf-friendly jobs. 0 disables the schedule. */
  jobsAgentIntervalHours: Number(read('JOBS_AGENT_INTERVAL_HOURS') ?? '12'),
  /** Comma-separated JSON feed URLs that return jobs (see docs/BACKEND.md). */
  jobFeeds: (read('JOB_FEEDS') ?? '').split(',').map(item => item.trim()).filter(Boolean),
  /** Live job sources (Workable, company career boards, remote-job APIs). Set SANAD_DISABLE_JOB_SOURCES=1 to turn off. */
  jobSourcesEnabled: read('SANAD_DISABLE_JOB_SOURCES') !== '1',
  /** Official company career boards: «platform:slug:Company», comma-separated (platform = greenhouse | ashby). */
  jobBoards: (read('JOB_BOARDS') ?? 'greenhouse:tamara:Tamara,greenhouse:careem:Careem,ashby:leantech:Lean Technologies')
    .split(',').map(item => item.trim().split(':')).filter(parts => parts.length >= 3 && ['greenhouse', 'ashby'].includes(parts[0]!))
    .map(([platform, slug, ...company]) => ({ platform: platform as 'greenhouse' | 'ashby', slug: slug!, company: company.join(':') })),
  /** X (Twitter) API v2 bearer token: X allows searching posts only through its official API. */
  xBearerToken: read('X_BEARER_TOKEN'),
  /** Admin emails: these accounts can run the jobs agent and add jobs. */
  adminEmails: (read('SANAD_ADMIN_EMAILS') ?? '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean),
  sessionDays: Number(read('SESSION_DAYS') ?? '30'),
  production: process.env['NODE_ENV'] === 'production',
  maxCvBytes: 10 * 1024 * 1024,
};
