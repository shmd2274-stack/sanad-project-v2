/**
 * Ordered, append-only migrations. Never edit a migration that has shipped — add a new one.
 * They run inside a transaction at startup and are recorded in `schema_migrations`.
 */
export const migrations: { id: string; sql: string }[] = [
  {
    id: '0001_initial',
    sql: `
CREATE TABLE users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'candidate' CHECK (role IN ('candidate', 'employer', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  ip text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE user_settings (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  terms_accepted boolean NOT NULL DEFAULT false,
  terms_accepted_at timestamptz,
  training_consent boolean NOT NULL DEFAULT false,
  training_consent_at timestamptz,
  dark_mode boolean NOT NULL DEFAULT false,
  selected_job_id text,
  interpreter_requested boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cv_documents (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL,
  content bytea NOT NULL,
  extracted_text text,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'analysing', 'analysed', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  analysed_at timestamptz
);
CREATE INDEX cv_documents_user_idx ON cv_documents (user_id, created_at);

CREATE TABLE cv_profiles (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cv_id text NOT NULL REFERENCES cv_documents(id) ON DELETE CASCADE,
  summary text NOT NULL DEFAULT '',
  skills jsonb NOT NULL DEFAULT '[]',
  experience jsonb NOT NULL DEFAULT '[]',
  education jsonb NOT NULL DEFAULT '[]',
  job_titles jsonb NOT NULL DEFAULT '[]',
  languages jsonb NOT NULL DEFAULT '[]',
  certifications jsonb NOT NULL DEFAULT '[]',
  suggested_roles jsonb NOT NULL DEFAULT '[]',
  years_experience double precision,
  engine text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id text PRIMARY KEY,
  title text NOT NULL,
  english text NOT NULL DEFAULT '',
  company text NOT NULL,
  mark text NOT NULL DEFAULT '',
  location text NOT NULL,
  mode text NOT NULL,
  salary text NOT NULL DEFAULT '',
  description text NOT NULL,
  skills jsonb NOT NULL DEFAULT '[]',
  tone text NOT NULL DEFAULT 'teal',
  source text NOT NULL,
  source_name text,
  source_url text,
  posted_at timestamptz,
  deadline timestamptz,
  deaf_friendly_reason text,
  accommodations jsonb NOT NULL DEFAULT '[]',
  interview_questions jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'hidden')),
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX jobs_fingerprint_key ON jobs (fingerprint);
CREATE INDEX jobs_status_idx ON jobs (status);

CREATE TABLE job_matches (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  reason text NOT NULL,
  matched_skills jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);

CREATE TABLE agent_runs (
  id text PRIMARY KEY,
  agent text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  stats jsonb NOT NULL DEFAULT '{}',
  error text
);

CREATE TABLE applications (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('applied', 'reviewing', 'nominated', 'scheduled', 'completed', 'accepted', 'rejected', 'withdrawn')),
  applied_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);

CREATE TABLE application_events (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX application_events_user_job_idx ON application_events (user_id, job_id, id);

CREATE TABLE interview_schedules (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);

CREATE TABLE job_skill_overrides (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  skills jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);

CREATE TABLE job_preferences (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '[]',
  additional_needs text NOT NULL DEFAULT '',
  plan_reviewed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);

CREATE TABLE training_progress (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  completed jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);

CREATE TABLE interpreters (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text,
  phone text,
  meeting_url text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE interview_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  preview boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended')),
  communication text NOT NULL DEFAULT 'sign',
  recruiter_token_hash text NOT NULL,
  interpreter_status text NOT NULL DEFAULT 'standby' CHECK (interpreter_status IN ('standby', 'joined', 'unavailable')),
  interpreter_id text REFERENCES interpreters(id) ON DELETE SET NULL,
  interpreter_reason text,
  misunderstandings integer NOT NULL DEFAULT 0,
  consecutive_misunderstandings integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_seconds integer
);
CREATE INDEX interview_sessions_user_idx ON interview_sessions (user_id);

CREATE TABLE interview_questions (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  original text NOT NULL,
  simple text NOT NULL,
  sign_playlist jsonb NOT NULL DEFAULT '[]',
  engine text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interview_questions_session_idx ON interview_questions (session_id, seq);

CREATE TABLE interview_answers (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  question_id text NOT NULL REFERENCES interview_questions(id) ON DELETE CASCADE,
  draft_text text NOT NULL,
  glosses jsonb NOT NULL DEFAULT '[]',
  confidence double precision NOT NULL DEFAULT 0,
  engine text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected')),
  final_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX interview_answers_session_idx ON interview_answers (session_id);

CREATE TABLE interview_events (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  type text NOT NULL,
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'candidate', 'recruiter')),
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interview_events_session_idx ON interview_events (session_id, id);

CREATE TABLE reports (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  session_id text REFERENCES interview_sessions(id) ON DELETE SET NULL,
  answers jsonb NOT NULL DEFAULT '[]',
  questions jsonb NOT NULL DEFAULT '[]',
  duration_seconds integer NOT NULL DEFAULT 0,
  shared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_user_idx ON reports (user_id, created_at);
`,
  },
  {
    id: '0002_cv_reading_and_personal_job_search',
    sql: `
ALTER TABLE cv_profiles ADD COLUMN experience_details jsonb NOT NULL DEFAULT '[]';
ALTER TABLE cv_profiles ADD COLUMN career_level text;
ALTER TABLE cv_profiles ADD COLUMN search_keywords jsonb NOT NULL DEFAULT '[]';
ALTER TABLE agent_runs ADD COLUMN user_id text REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX agent_runs_agent_user_idx ON agent_runs (agent, user_id, started_at);
`,
  },
];
