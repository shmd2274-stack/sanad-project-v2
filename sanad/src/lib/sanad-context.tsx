import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, apiEnabled, errorMessage } from './api';
import { canUpdateApplication, communicationPreferences, scheduleConflict, interviewSchedules, jobs as builtInJobs, mockCvProfile, previousReports, type ApplicationStatus, type CvStatus, type InterviewReport, type Job } from './sanad-data';
import type { SanadSnapshot } from './sanad-snapshot';
import { SanadContext, type CvProfileSummary } from './sanad-state';
import { getTrainingReadiness, recordTrainingQuestion, type TrainingProgress } from './training-readiness';

const NO_CAPABILITIES: SanadSnapshot['capabilities'] = { claude: false };

/**
 * Guests (and unit tests) get the original in-memory demo session.
 * A signed-in account (`initial` from the server, or after sign-in) is loaded from and saved to the database.
 */
export function SanadProvider({ children, initial = null }: { children: ReactNode; initial?: SanadSnapshot | null }) {
  const [boot, setBoot] = useState<{ key: number; snapshot: SanadSnapshot | null }>({ key: 0, snapshot: initial });
  const signOut = useCallback(() => {
    if (apiEnabled()) void api('POST', '/auth/logout').catch(() => undefined);
    setBoot(current => ({ key: current.key + 1, snapshot: null }));
  }, []);
  return <SanadSessionProvider key={boot.key} snapshot={boot.snapshot} signOut={signOut}>{children}</SanadSessionProvider>;
}

function cvStatusOf(snapshot: SanadSnapshot | null): CvStatus {
  if (!snapshot) return 'analysed';
  const status = snapshot.cv?.status;
  return status === 'analysed' || status === 'analysing' ? status : 'uploaded';
}

function SanadSessionProvider({ children, signOut, snapshot }: { children: ReactNode; signOut: () => void; snapshot: SanadSnapshot | null }) {
  const s = snapshot;
  const [serverMode, setServerMode] = useState(s !== null);
  const [candidateName, setCandidateName] = useState(s?.user.name ?? 'أحمد');
  const [candidateEmail, setCandidateEmail] = useState(s?.user.email ?? '');
  const [signedIn, setSignedIn] = useState(s !== null);
  const [termsAccepted, setTermsAcceptedState] = useState(s?.settings.termsAccepted ?? false);
  const [trainingConsent, setTrainingConsentState] = useState(s?.settings.trainingConsent ?? false);
  const [darkMode, setDarkModeState] = useState(s?.settings.darkMode ?? false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [jobList, setJobList] = useState<Job[]>(s?.jobs ?? builtInJobs);
  const [schedules, setSchedules] = useState<Record<string, string>>(s?.schedules ?? interviewSchedules);
  const [applicationDates, setApplicationDates] = useState<Record<string, string>>(s?.applicationDates ?? { analyst: '2026-11-12T09:00:00+03:00', support: '2026-11-13T09:00:00+03:00' });
  const [applicationHistory, setApplicationHistory] = useState<Record<string, { status: ApplicationStatus; date: string }[]>>(s?.applicationHistory ?? {
    analyst: [{ status: 'applied', date: '2026-11-12T09:00:00+03:00' }, { status: 'reviewing', date: '2026-11-13T09:00:00+03:00' }, { status: 'nominated', date: '2026-11-14T09:00:00+03:00' }],
    support: [{ status: 'applied', date: '2026-11-13T09:00:00+03:00' }, { status: 'reviewing', date: '2026-11-14T09:00:00+03:00' }, { status: 'nominated', date: '2026-11-15T09:00:00+03:00' }],
  });
  const [jobSkills, setSkills] = useState<Record<string, string[]>>(s?.jobSkills ?? {});
  const [selectedJobId, setSelectedJobId] = useState<string>(s?.settings.selectedJobId ?? s?.jobs[0]?.id ?? builtInJobs[0]?.id ?? 'analyst');
  const [cvName, setCvName] = useState(s ? s.cv?.name ?? '' : 'أحمد_السيرة_الذاتية.pdf');
  const [cvStatus, setCvStatus] = useState<CvStatus>(cvStatusOf(s));
  const [cvError, setCvError] = useState(s?.cv?.status === 'failed' ? s.cv.error ?? '' : '');
  const [cvProfile, setCvProfile] = useState<CvProfileSummary | null>(s ? s.cvProfile : mockCvProfile);
  const [applications, setApplications] = useState<Record<string, ApplicationStatus>>(s?.applications ?? { analyst: 'nominated', support: 'nominated', designer: 'available' });
  const [reviewedPlans, setReviewedPlans] = useState<string[]>(s?.reviewedPlans ?? []);
  const [preferences, setPreferences] = useState<Record<string, string[]>>(s?.preferences ?? {});
  const [additionalCommunicationNeeds, setAdditionalNeeds] = useState<Record<string, string>>(s?.additionalCommunicationNeeds ?? {});
  const [now, setNow] = useState<number>();
  const [reports, setReports] = useState<InterviewReport[]>(s?.reports ?? previousReports);
  const [interpreterRequested, setInterpreterRequestedState] = useState(s?.settings.interpreterRequested ?? false);
  const [trainingProgress, setTrainingProgress] = useState<TrainingProgress>(s?.trainingProgress ?? {});
  const practiceCompleted = getTrainingReadiness(trainingProgress[selectedJobId]) === 100;
  const [interviewCompleted, setInterviewCompleted] = useState(false);
  const [sentAnswers, setSentAnswers] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState(s?.capabilities ?? NO_CAPABILITIES);
  const uploadRef = useRef<Promise<boolean> | null>(null);
  const needsTimers = useRef<Record<string, number>>({});
  const live = serverMode && apiEnabled();
  const knownJob = (id: string) => jobList.some(job => job.id === id);

  const applySnapshot = useCallback((next: SanadSnapshot) => {
    setServerMode(true); setSignedIn(true);
    setCandidateName(next.user.name); setCandidateEmail(next.user.email);
    setTermsAcceptedState(next.settings.termsAccepted); setTrainingConsentState(next.settings.trainingConsent); setDarkModeState(next.settings.darkMode);
    setInterpreterRequestedState(next.settings.interpreterRequested);
    setJobList(next.jobs); setSchedules(next.schedules); setApplicationDates(next.applicationDates); setApplicationHistory(next.applicationHistory);
    setApplications(next.applications); setSkills(next.jobSkills); setPreferences(next.preferences); setAdditionalNeeds(next.additionalCommunicationNeeds);
    setReviewedPlans(next.reviewedPlans); setTrainingProgress(next.trainingProgress); setReports(next.reports); setCapabilities(next.capabilities);
    setCvName(next.cv?.name ?? ''); setCvStatus(cvStatusOf(next)); setCvProfile(next.cvProfile); setCvError(next.cv?.status === 'failed' ? next.cv.error ?? '' : '');
    setSelectedJobId(current => next.jobs.some(job => job.id === current) ? current : next.settings.selectedJobId ?? next.jobs[0]?.id ?? current);
  }, []);

  const refresh = useCallback(async () => {
    if (!apiEnabled()) return;
    try { applySnapshot(await api<SanadSnapshot>('GET', '/me/state')); }
    catch (error) { if ((error as { status?: number }).status === 401) signOut(); }
  }, [applySnapshot, signOut]);

  /** Saves a change; on failure the screen is re-synced with the database. */
  const persist = useCallback((request: () => Promise<unknown>, reload = false) => {
    if (!live) return;
    void request().then(() => reload ? refresh() : undefined).catch(error => {
      console.warn('[sanad] save failed:', errorMessage(error));
      void refresh();
    });
  }, [live, refresh]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    return () => document.documentElement.classList.remove('dark');
  }, [darkMode]);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function authenticate(mode: 'signin' | 'signup', input: { name: string; email: string; password: string }) {
    if (!apiEnabled()) { signIn(input.name, input.email); return null; }
    try {
      const { snapshot: next } = await api<{ snapshot: SanadSnapshot }>('POST', mode === 'signup' ? '/auth/signup' : '/auth/login', mode === 'signup' ? input : { email: input.email, password: input.password });
      applySnapshot(next);
      return null;
    } catch (error) { return errorMessage(error); }
  }
  function signIn(name: string, email = '') { if (!name.trim()) return; setCandidateName(name.trim()); setCandidateEmail(email.trim()); setSignedIn(true); }
  function updateProfile(name: string, email: string) {
    if (!signedIn || !name.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) return;
    setCandidateName(name.trim()); setCandidateEmail(email.trim());
    persist(() => api('PATCH', '/me', { name: name.trim(), email: email.trim() }));
  }
  const saveSettings = (patch: Record<string, unknown>) => persist(() => api('PATCH', '/me/settings', patch));
  function setTermsAccepted(value: boolean) { setTermsAcceptedState(value); saveSettings({ termsAccepted: value }); }
  function setTrainingConsent(value: boolean) { setTrainingConsentState(value); saveSettings({ trainingConsent: value }); }
  function setDarkMode(value: boolean) { setDarkModeState(value); saveSettings({ darkMode: value }); }
  function setInterpreterRequested(value: boolean) { setInterpreterRequestedState(value); saveSettings({ interpreterRequested: value }); }

  function updateApplication(id: string, status: ApplicationStatus) {
    if (!knownJob(id) || !canUpdateApplication(applications[id] ?? 'available', status)) return;
    const date = new Date().toISOString();
    setApplications(current => ({ ...current, [id]: status }));
    setApplicationHistory(current => ({ ...current, [id]: [...(current[id] ?? []), { status, date }] }));
    if (status === 'applied') setApplicationDates(current => ({ ...current, [id]: date }));
    persist(() => status === 'applied' ? api('POST', '/applications', { jobId: id }) : api('POST', `/applications/${encodeURIComponent(id)}/status`, { status }), true);
  }
  function scheduleInterview(id: string, date: string) {
    if (!knownJob(id)) return 'الوظيفة غير موجودة.';
    const conflict = scheduleConflict(id, date, schedules);
    if (conflict) return conflict;
    setSchedules(current => ({ ...current, [id]: date }));
    const timestamp = new Date().toISOString();
    setApplicationHistory(current => ({ ...current, [id]: [...(current[id] ?? []), { status: applications[id] ?? 'available', date: timestamp }] }));
    persist(() => api('PUT', `/jobs/${encodeURIComponent(id)}/schedule`, { startsAt: date }));
    return null;
  }

  // CV analysis: the demo session simulates it; a real account runs the CV agent and polls its status.
  useEffect(() => {
    if (cvStatus !== 'analysing') return;
    if (!live) {
      const timer = window.setTimeout(() => setCvStatus('analysed'), 1200);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false; let timer = 0;
    const poll = async () => {
      try {
        const { cv } = await api<{ cv: { status: string; error: string | null } | null }>('GET', '/cv');
        if (cancelled) return;
        if (cv?.status === 'analysed') { await refresh(); return; }
        if (cv?.status === 'failed' || !cv) { setCvStatus('uploaded'); setCvError(cv?.error ?? 'تعذّر تحليل السيرة الذاتية.'); return; }
        timer = window.setTimeout(() => void poll(), 1500);
      } catch (error) { if (!cancelled) { setCvStatus('uploaded'); setCvError(errorMessage(error)); } }
    };
    void (async () => {
      try {
        if ((await uploadRef.current) === false) { if (!cancelled) setCvStatus('uploaded'); return; }
        setCvError(''); await api('POST', '/cv/analyse'); if (!cancelled) void poll();
      }
      catch (error) { if (!cancelled) { setCvStatus('uploaded'); setCvError(errorMessage(error)); } }
    })();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [cvStatus, live, refresh]);

  function uploadCv(file: File) {
    setCvName(file.name); setCvStatus('uploaded'); setCvError('');
    if (!live) return;
    const form = new FormData(); form.append('file', file);
    uploadRef.current = api('POST', '/cv', form).then(() => true, error => { setCvError(errorMessage(error)); setCvName(''); return false; });
  }

  function selectJob(id: string) {
    if (!knownJob(id) || id === selectedJobId) return;
    setSelectedJobId(id);
    setInterviewCompleted(false);
    setSentAnswers([]);
    saveSettings({ selectedJobId: id });
  }
  function applyToJob(id: string) {
    if (cvStatus !== 'analysed' || (applications[id] ?? 'available') !== 'available') return;
    updateApplication(id, 'applied');
    selectJob(id);
  }
  function nominateJob(id: string) {
    updateApplication(id, 'nominated');
  }
  function completeTrainingQuestion(jobId: string, questionIndex: number) {
    if (!knownJob(jobId)) return;
    setTrainingProgress(current => recordTrainingQuestion(current, jobId, questionIndex));
    persist(() => api('POST', `/training/${encodeURIComponent(jobId)}`, { questionIndex }));
  }
  function reviewPlan(id: string) {
    setReviewedPlans(current => current.includes(id) ? current : [...current, id]);
    persist(() => api('PUT', `/jobs/${encodeURIComponent(id)}/preferences`, { planReviewed: true }));
  }
  function setJobPreferences(id: string, values: string[]) {
    if (!knownJob(id)) return;
    const allowed = new Set<string>(communicationPreferences.map(item => item.id));
    const next = [...new Set(values.filter(value => allowed.has(value)))];
    setPreferences(current => ({ ...current, [id]: next }));
    persist(() => api('PUT', `/jobs/${encodeURIComponent(id)}/preferences`, { preferences: next }));
  }
  function setAdditionalCommunicationNeeds(id: string, value: string) {
    if (!knownJob(id)) return;
    setAdditionalNeeds(current => ({ ...current, [id]: value }));
    if (!live) return;
    window.clearTimeout(needsTimers.current[id]);
    needsTimers.current[id] = window.setTimeout(() => persist(() => api('PUT', `/jobs/${encodeURIComponent(id)}/preferences`, { additionalNeeds: value })), 600);
  }
  function setJobSkills(id: string, skills: string[]) {
    setSkills(current => ({ ...current, [id]: skills }));
    persist(() => api('PUT', `/jobs/${encodeURIComponent(id)}/skills`, { skills }));
  }
  function finishInterview(questions?: string[], durationSeconds = 0) {
    if (!['nominated', 'scheduled'].includes(applications[selectedJobId] ?? '')) return;
    const answers = [...sentAnswers];
    setInterviewCompleted(true);
    const date = new Date().toISOString();
    setApplications(current => ({ ...current, [selectedJobId]: 'completed' }));
    setApplicationHistory(current => ({ ...current, [selectedJobId]: [...(current[selectedJobId] ?? []), { status: 'completed', date }] }));
    setReports(current => [{ id: `session-${Date.now()}`, jobId: selectedJobId, date, answers, questions: questions ? [...questions] : [], durationSeconds }, ...current]);
    setSentAnswers([]);
    persist(() => api('POST', '/reports', { jobId: selectedJobId, answers, questions: questions ?? [], durationSeconds }), true);
  }
  return <SanadContext.Provider value={{ serverMode: live, authenticate, refresh, jobs: jobList, cvProfile, cvError, uploadCv, capabilities, termsAccepted, setTermsAccepted, trainingConsent, setTrainingConsent, darkMode, setDarkMode, candidateName, candidateEmail, signedIn, signIn, updateProfile, signOut, guideOpen, openGuide: () => setGuideOpen(true), closeGuide: () => setGuideOpen(false), schedules, scheduleInterview, applicationDates, applicationHistory, updateApplication, jobSkills, setJobSkills, selectedJobId, selectJob, cvName, setCvName, cvStatus, setCvStatus, applications, applyToJob, nominateJob, reviewedPlans, reviewPlan, preferences, setJobPreferences, additionalCommunicationNeeds, setAdditionalCommunicationNeeds, now, reports, finishInterview, interpreterRequested, setInterpreterRequested, practiceCompleted, trainingProgress, completeTrainingQuestion, interviewCompleted, setInterviewCompleted, sentAnswers, setSentAnswers }}>{children}</SanadContext.Provider>;
}
export function useSanad() {
  const context = useContext(SanadContext);
  if (!context) throw new Error('SanadProvider is required');
  return context;
}
