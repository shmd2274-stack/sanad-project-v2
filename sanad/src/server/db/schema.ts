import { bigserial, boolean, customType, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { AtsReport, ExperienceDetail, ProjectView } from '@/lib/sanad-snapshot';

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => 'bytea' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/* ───────────── Accounts ───────────── */

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('candidate'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  lastLoginAt: ts('last_login_at'),
}, table => [uniqueIndex('users_email_key').on(table.email)]);

export const sessions = pgTable('sessions', {
  /** sha256 of the random token stored in the cookie — the raw token never touches the database. */
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  userAgent: text('user_agent'),
  ip: text('ip'),
}, table => [index('sessions_user_idx').on(table.userId)]);

export const userSettings = pgTable('user_settings', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  termsAccepted: boolean('terms_accepted').notNull().default(false),
  termsAcceptedAt: ts('terms_accepted_at'),
  trainingConsent: boolean('training_consent').notNull().default(false),
  trainingConsentAt: ts('training_consent_at'),
  darkMode: boolean('dark_mode').notNull().default(false),
  selectedJobId: text('selected_job_id'),
  interpreterRequested: boolean('interpreter_requested').notNull().default(false),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/* ───────────── CV agent ───────────── */

export const cvDocuments = pgTable('cv_documents', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  content: bytea('content').notNull(),
  extractedText: text('extracted_text'),
  status: text('status').notNull().default('uploaded'),
  error: text('error'),
  createdAt: ts('created_at').notNull().defaultNow(),
  analysedAt: ts('analysed_at'),
}, table => [index('cv_documents_user_idx').on(table.userId, table.createdAt)]);

export const cvProfiles = pgTable('cv_profiles', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  cvId: text('cv_id').notNull().references(() => cvDocuments.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull().default(''),
  skills: jsonb('skills').$type<string[]>().notNull().default([]),
  experience: jsonb('experience').$type<string[]>().notNull().default([]),
  education: jsonb('education').$type<string[]>().notNull().default([]),
  jobTitles: jsonb('job_titles').$type<string[]>().notNull().default([]),
  languages: jsonb('languages').$type<string[]>().notNull().default([]),
  certifications: jsonb('certifications').$type<string[]>().notNull().default([]),
  suggestedRoles: jsonb('suggested_roles').$type<string[]>().notNull().default([]),
  yearsExperience: doublePrecision('years_experience'),
  experienceDetails: jsonb('experience_details').$type<ExperienceDetail[]>().notNull().default([]),
  careerLevel: text('career_level'),
  searchKeywords: jsonb('search_keywords').$type<string[]>().notNull().default([]),
  projects: jsonb('projects').$type<ProjectView[]>().notNull().default([]),
  ats: jsonb('ats').$type<AtsReport | null>(),
  /** Which offline-reader version produced this profile; older ones are re-read automatically. */
  parserVersion: integer('parser_version').notNull().default(0),
  engine: text('engine').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/* ───────────── Jobs agent ───────────── */

export interface JobQuestion { original: string; simple: string; answer?: string }

export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  english: text('english').notNull().default(''),
  company: text('company').notNull(),
  mark: text('mark').notNull().default(''),
  location: text('location').notNull(),
  mode: text('mode').notNull(),
  salary: text('salary').notNull().default(''),
  description: text('description').notNull(),
  skills: jsonb('skills').$type<string[]>().notNull().default([]),
  tone: text('tone').notNull().default('teal'),
  source: text('source').notNull(),
  sourceName: text('source_name'),
  sourceUrl: text('source_url'),
  postedAt: ts('posted_at'),
  deadline: ts('deadline'),
  deafFriendlyReason: text('deaf_friendly_reason'),
  accommodations: jsonb('accommodations').$type<string[]>().notNull().default([]),
  interviewQuestions: jsonb('interview_questions').$type<JobQuestion[]>().notNull().default([]),
  status: text('status').notNull().default('active'),
  fingerprint: text('fingerprint').notNull(),
  /** Title + organisation only: the same job found on several sites is listed once. */
  dedupeKey: text('dedupe_key'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, table => [uniqueIndex('jobs_fingerprint_key').on(table.fingerprint), index('jobs_status_idx').on(table.status)]);

export const jobMatches = pgTable('job_matches', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  score: integer('score').notNull(),
  reason: text('reason').notNull(),
  matchedSkills: jsonb('matched_skills').$type<string[]>().notNull().default([]),
  missingSkills: jsonb('missing_skills').$type<string[]>().notNull().default([]),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.userId, table.jobId] })]);

export const agentRuns = pgTable('agent_runs', {
  id: text('id').primaryKey(),
  agent: text('agent').notNull(),
  /** Set for a personalised run (jobs searched for one candidate's profile). */
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  stats: jsonb('stats').$type<Record<string, unknown>>().notNull().default({}),
  error: text('error'),
});

/* ───────────── Applications, schedule, timeline ───────────── */

export const applications = pgTable('applications', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  appliedAt: ts('applied_at'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.userId, table.jobId] })]);

export const applicationEvents = pgTable('application_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  note: text('note'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, table => [index('application_events_user_job_idx').on(table.userId, table.jobId, table.id)]);

export const interviewSchedules = pgTable('interview_schedules', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  startsAt: ts('starts_at').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.userId, table.jobId] })]);

/** Employer-side edits of the required skills, as shown to this candidate. */
export const jobSkillOverrides = pgTable('job_skill_overrides', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  skills: jsonb('skills').$type<string[]>().notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.userId, table.jobId] })]);

export const jobPreferences = pgTable('job_preferences', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  preferences: jsonb('preferences').$type<string[]>().notNull().default([]),
  additionalNeeds: text('additional_needs').notNull().default(''),
  planReviewedAt: ts('plan_reviewed_at'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.userId, table.jobId] })]);

export const trainingProgress = pgTable('training_progress', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  completed: jsonb('completed').$type<number[]>().notNull().default([]),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.userId, table.jobId] })]);

/* ───────────── Reports ───────────── */

export const reports = pgTable('reports', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  answers: jsonb('answers').$type<string[]>().notNull().default([]),
  questions: jsonb('questions').$type<string[]>().notNull().default([]),
  durationSeconds: integer('duration_seconds').notNull().default(0),
  sharedAt: ts('shared_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, table => [index('reports_user_idx').on(table.userId, table.createdAt)]);
