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
  /** Claude powers the CV, jobs and interview agents. Without it the agents use their offline engines. */
  anthropicEnabled: Boolean(read('ANTHROPIC_API_KEY') || read('ANTHROPIC_AUTH_TOKEN')) && read('SANAD_DISABLE_LLM') !== '1',
  anthropicModel: read('SANAD_CLAUDE_MODEL') ?? 'claude-opus-5-5',
  /** Folder that contains the Saudi Sign Language dataset (the one with `dataset/metadata/dataset.csv`). */
  sslDatasetDir: read('SSL_DATASET_DIR') ?? path.resolve(process.cwd(), '..', '..', 'Saudi-Sign-Language-main', 'Saudi-Sign-Language-main'),
  /** Optional landmark index built by scripts/ssl/build_landmark_index.py. */
  sslLandmarkIndex: read('SSL_LANDMARK_INDEX') ?? path.resolve(process.cwd(), '.data', 'ssl-landmarks.npz'),
  /** Python interpreter that has mediapipe installed (for the landmark recognizer). */
  sslPython: read('SSL_PYTHON'),
  /** How often the jobs agent searches for new deaf-friendly jobs. 0 disables the schedule. */
  jobsAgentIntervalHours: Number(read('JOBS_AGENT_INTERVAL_HOURS') ?? '12'),
  /** Comma-separated JSON feed URLs that return jobs (see docs/BACKEND.md). */
  jobFeeds: (read('JOB_FEEDS') ?? '').split(',').map(item => item.trim()).filter(Boolean),
  /** Admin emails: these accounts can run agents and manage interpreters. */
  adminEmails: (read('SANAD_ADMIN_EMAILS') ?? '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean),
  sessionDays: Number(read('SESSION_DAYS') ?? '30'),
  production: process.env['NODE_ENV'] === 'production',
  maxCvBytes: 10 * 1024 * 1024,
};
