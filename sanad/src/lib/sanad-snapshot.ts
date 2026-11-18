import type { ApplicationStatus, CvStatus, InterviewReport, Job } from './sanad-data';

/** Everything the UI needs about a signed-in candidate, loaded from the database in one request. */
export interface SanadSnapshot {
  user: { id: string; name: string; email: string; role: 'candidate' | 'employer' | 'admin' };
  settings: { termsAccepted: boolean; trainingConsent: boolean; darkMode: boolean; selectedJobId: string | null; interpreterRequested: boolean };
  cv: { name: string; status: CvStatus | 'failed'; uploadedAt: string; error: string | null } | null;
  cvProfile: CvProfileView | null;
  jobs: Job[];
  applications: Record<string, ApplicationStatus>;
  applicationDates: Record<string, string>;
  applicationHistory: Record<string, { status: ApplicationStatus; date: string }[]>;
  schedules: Record<string, string>;
  jobSkills: Record<string, string[]>;
  preferences: Record<string, string[]>;
  additionalCommunicationNeeds: Record<string, string>;
  reviewedPlans: string[];
  trainingProgress: Record<string, number[]>;
  reports: InterviewReport[];
  capabilities: { claude: boolean };
}

/** One role as read from the CV. `period` and `duration` are ready-to-show Arabic text. */
export interface ExperienceDetail {
  title: string;
  organization: string;
  location: string;
  start: string | null;
  end: string | null;
  current: boolean;
  period: string;
  duration: string;
  highlights: string[];
  /** job | internship (co-op, Tamheer…) | volunteer. Older profiles may not have it. */
  kind?: 'job' | 'internship' | 'volunteer';
}

export interface ProjectView { name: string; tools: string[]; description: string }

/** One ATS check: how well the CV does (0–1) and what to fix, in Arabic. */
export interface AtsCheck { id: string; label: string; score: number; weight: number; tip: string }

/** How an Applicant Tracking System reads this CV: a 0–100 score, checks, and the keywords it indexes. */
export interface AtsReport {
  score: number;
  rating: 'ممتاز' | 'جيد' | 'مقبول' | 'ضعيف';
  checks: AtsCheck[];
  /** Most valuable improvements first. */
  tips: string[];
  keywords: string[];
  contact: { email: boolean; phone: boolean; city: string | null; linkedin: boolean; portfolio: boolean };
  sections: string[];
  stats: { words: number; bullets: number; quantified: number; actionVerbs: number; roles: number };
}

export interface CvProfileView {
  summary: string;
  skills: string[];
  /** Same roles as `experienceDetails`, one formatted line each (what the dashboard lists). */
  experience: string[];
  experienceDetails: ExperienceDetail[];
  careerLevel: string | null;
  /** Arabic + English titles and skills the jobs agent searches with. */
  searchKeywords: string[];
  education: string[];
  jobTitles: string[];
  languages: string[];
  certifications: string[];
  suggestedRoles: string[];
  yearsExperience: number | null;
  projects: ProjectView[];
  /** ATS reading of the CV (score, checks, tips). Null for profiles analysed before ATS existed. */
  ats: AtsReport | null;
  engine: 'claude' | 'heuristic';
}
