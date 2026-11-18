import type { CvProfileView } from '@/lib/sanad-snapshot';
import { env } from '../../env';
import { normalizeArabic, tokenize, uniqueStrings } from '../../text/arabic';
import { pieceKind } from '../cv/experience';
import { canonicalSkill, findSkills, skillGroup } from '../skills-taxonomy';
import type { Posting } from './jobs-agent';
import { matchJob, titleTokens } from './matching';

/**
 * Job sources that work without any AI key: public job-search and career-board APIs that allow
 * automated access (robots.txt checked). Each CV gets its own search plan (its roles and skills in
 * English, its level), every result is mapped to Sanad's job template, filtered and ranked for the CV.
 *
 *  - Workable job search (jobs.workable.com): thousands of employers, filtered to Saudi Arabia.
 *  - Official company career boards (Greenhouse / Ashby): `JOB_BOARDS`.
 *  - Remote-job APIs open to applicants in Saudi Arabia: Remotive, Jobicy, Himalayas, Remote OK.
 *  - X (Twitter): only through the official API — X does not allow search without `X_BEARER_TOKEN`.
 * Not used: LinkedIn and SmartRecruiters (their robots.txt forbids automated access), Jadarat / Qiwa
 * (no public API; their apps sit behind protections we do not bypass).
 */

export type SourceStatus = 'results' | 'no_results' | 'unreachable' | 'needs_key';
export interface SourceReport { source: string; status: SourceStatus; note: string; count: number }
export interface SearchPlan { queries: string[]; roles: string[]; graduate: boolean; senior: boolean }
type Fetch = typeof fetch;
interface Context { fetch: Fetch; now: Date }
interface Connector { name: string; search(plan: SearchPlan, ctx: Context): Promise<Posting[]> }

const USER_AGENT = 'SanadJobsAgent/1.0';
const MAX_AGE_DAYS = 120;

/* ───────────── Settings (tests inject a fake fetch) ───────────── */

const settings: { fetch: Fetch | null; enabled: boolean | null; autoRefresh: boolean | null } = { fetch: null, enabled: null, autoRefresh: null };
export function configureJobSources(options: { fetch?: Fetch | null; enabled?: boolean | null; autoRefresh?: boolean | null }) {
  if (options.fetch !== undefined) { settings.fetch = options.fetch; cache.clear(); }
  if (options.enabled !== undefined) settings.enabled = options.enabled;
  if (options.autoRefresh !== undefined) settings.autoRefresh = options.autoRefresh;
}
/** Live sources are off in tests unless a test provides its own fetch. */
export const jobSourcesEnabled = () => settings.enabled ?? (env.jobSourcesEnabled && (!process.env['VITEST'] || settings.fetch !== null));
export const autoRefreshEnabled = () => settings.autoRefresh ?? (jobSourcesEnabled() && !process.env['VITEST']);

const cache = new Map<string, { at: number; body: unknown }>();
async function getJson(url: string, ctx: Context, init: { headers?: Record<string, string>; cacheHours?: number } = {}): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && init.cacheHours && Date.now() - hit.at < init.cacheHours * 3_600_000) return hit.body;
  const response = await ctx.fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...init.headers }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json() as unknown;
  if (init.cacheHours) cache.set(url, { at: Date.now(), body });
  return body;
}

/* ───────────── Mapping to the Sanad job template ───────────── */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export const stripHtml = (html: string) => html
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, '. ').replace(/<[^>]+>/g, ' ')
  .replace(/&(#39|[a-z]+);/gi, (all, name: string) => ENTITIES[name.toLowerCase()] ?? all)
  .replace(/\s*\.\s*\.+/g, '.').replace(/\s+/g, ' ').trim();
const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1).replace(/\s\S*$/, '')}…` : text;

const CITIES_AR: [RegExp, string][] = [
  [/riyadh/i, 'الرياض'], [/jedd?ah|jiddah/i, 'جدة'], [/dammam/i, 'الدمام'], [/khobar/i, 'الخبر'], [/dhahran/i, 'الظهران'],
  [/makkah|mecca/i, 'مكة'], [/madinah|medina/i, 'المدينة'], [/taif/i, 'الطائف'], [/tabuk/i, 'تبوك'], [/abha/i, 'أبها'],
  [/buraid|buraydah|qassim/i, 'بريدة'], [/\bhail\b|ha'il/i, 'حائل'], [/jazan|jizan/i, 'جازان'], [/najran/i, 'نجران'],
  [/hofuf|ahsa/i, 'الأحساء'], [/jubail/i, 'الجبيل'], [/yanbu/i, 'ينبع'], [/neom/i, 'نيوم'], [/khamis/i, 'خميس مشيط'],
  [/qatif/i, 'القطيف'], [/kharj/i, 'الخرج'], [/sakaka|jouf/i, 'سكاكا'], [/arar/i, 'عرعر'], [/baha/i, 'الباحة'], [/ula\b/i, 'العلا'],
];
export function cityAr(place: string): string {
  for (const [pattern, name] of CITIES_AR) if (pattern.test(place)) return name;
  return /saudi|ksa/i.test(place) ? 'السعودية' : place.trim() || 'السعودية';
}

/** Jobs that depend on hearing (phone or call-centre work) are not suitable and are left out. */
const VOICE_HEAVY = /(call cent(er|re)|telesales|tele-?marketing|cold call|phone support|phone sales|voice process|inbound calls|outbound calls|answering calls|switchboard|radio operator|مركز اتصال|مركز الاتصال|مبيعات هاتفية|الرد على المكالمات|تسويق هاتفي)/i;
const WRITTEN_WORK = /(data|analyst|developer|engineer|designer|accountant|software|it |cyber|ai |machine learning|content|writer|editor|research|finance|audit|admin|hr |marketing|bi |quality|tester|qa |محلل|مطور|مهندس|مصمم|محاسب|مدقق|باحث|كاتب|مسوق)/i;
function deafFriendlyReason(remote: boolean, title: string): string {
  if (remote) return 'عمل عن بُعد يُنجز بالتواصل الكتابي والأدوات الرقمية، ولا يشترط الإعلان مكالمات هاتفية.';
  if (WRITTEN_WORK.test(`${title} `)) return 'مهام الدور مكتبية ورقمية يمكن أداؤها بالتواصل الكتابي، ولا يشترط الإعلان مكالمات هاتفية. اطلب التسهيلات (مقابلة مكتوبة أو مترجم لغة إشارة) عند التقديم.';
  return 'لا يشترط الإعلان مكالمات هاتفية أو عملًا يعتمد على السمع. اطلب التسهيلات (مقابلة مكتوبة أو مترجم لغة إشارة) عند التقديم.';
}

function posting(input: { title: string; company: string; place: string; remote: boolean; hybrid?: boolean; description: string; requirements?: string; url: string; sourceName: string; postedAt: string | null; salary?: string }): Posting {
  // Required skills come from the title and the requirements — not from the company's description of itself.
  const text = input.requirements && input.requirements.length > 80 ? `${input.title}. ${input.requirements}` : `${input.title}. ${input.description}`;
  const summary = clip(input.description, 330);
  const requirements = input.requirements ? clip(input.requirements, 240) : '';
  const latin = /[a-z]/i.test(input.title) && !/[ء-ي]/.test(input.title);
  return {
    title: clip(input.title.trim(), 120), english: latin ? clip(input.title.trim(), 120) : '', company: input.company.trim(),
    location: input.remote ? 'عن بُعد' : cityAr(input.place), mode: input.remote ? 'عن بُعد' : input.hybrid ? 'هجين' : 'حضوري',
    salary: input.salary ?? '', description: requirements ? `${summary} المتطلبات: ${requirements}` : summary,
    skills: findSkills(text).slice(0, 10), sourceUrl: input.url, sourceName: input.sourceName, postedAt: input.postedAt, deadline: null,
    deafFriendlyReason: deafFriendlyReason(input.remote, input.title), accommodations: [],
  };
}

const SAUDI = /(saudi|ksa|riyadh|jedd?ah|dammam|khobar|dhahran|makkah|madinah|jubail|yanbu|neom|السعودية|الرياض)/i;
/** Remote jobs a person living in Saudi Arabia can apply for. */
const OPEN_TO_SAUDI = /(worldwide|anywhere|global|saudi|ksa|middle east|mena|gcc|emea|gulf)/i;

/* ───────────── Connectors ───────────── */

interface WorkableJob { title: string; state?: string; url: string; workplace?: string; created?: string; socialSharingDescription?: string; description?: string; requirementsSection?: string; company?: { title?: string }; location?: { city?: string; countryName?: string } }
export const workable: Connector = {
  name: 'Workable',
  async search(plan, ctx) {
    const out: Posting[] = [];
    for (const query of plan.queries.slice(0, 5)) {
      const body = await getJson(`https://jobs.workable.com/api/v1/jobs?query=${encodeURIComponent(query)}&location=${encodeURIComponent('Saudi Arabia')}`, ctx, { cacheHours: 3 }) as { jobs?: WorkableJob[] };
      for (const job of body.jobs ?? []) {
        if (job.state && job.state !== 'published') continue;
        const remote = job.workplace === 'remote';
        if (!remote && !SAUDI.test(job.location?.countryName ?? '')) continue;
        out.push(posting({
          title: job.title, company: job.company?.title ?? '', place: job.location?.city ?? '', remote, hybrid: job.workplace === 'hybrid',
          description: stripHtml(job.description ?? job.socialSharingDescription ?? ''), requirements: stripHtml(job.requirementsSection ?? ''),
          url: job.url, sourceName: 'Workable', postedAt: job.created ?? null,
        }));
      }
    }
    return out;
  },
};

interface GreenhouseJob { title: string; absolute_url: string; updated_at?: string; first_published?: string; content?: string; location?: { name?: string } }
interface AshbyJob { title: string; jobUrl?: string; applyUrl?: string; publishedAt?: string; descriptionPlain?: string; isRemote?: boolean; workplaceType?: string; location?: string; secondaryLocations?: { location?: string }[] }
export const careerBoards: Connector = {
  name: 'صفحات التوظيف الرسمية للشركات',
  async search(_plan, ctx) {
    const out: Posting[] = [];
    for (const board of env.jobBoards) {
      if (board.platform === 'greenhouse') {
        const body = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.slug)}/jobs?content=true`, ctx, { cacheHours: 6 }) as { jobs?: GreenhouseJob[] };
        for (const job of body.jobs ?? []) {
          const place = job.location?.name ?? '';
          const remote = /remote/i.test(place) && OPEN_TO_SAUDI.test(place);
          if (!SAUDI.test(place) && !remote) continue;
          out.push(posting({ title: job.title, company: board.company, place, remote, description: stripHtml(job.content ?? ''), url: job.absolute_url, sourceName: `صفحة توظيف ${board.company}`, postedAt: job.first_published ?? job.updated_at ?? null }));
        }
      } else if (board.platform === 'ashby') {
        const body = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.slug)}`, ctx, { cacheHours: 6 }) as { jobs?: AshbyJob[] };
        for (const job of body.jobs ?? []) {
          const places = [job.location ?? '', ...(job.secondaryLocations ?? []).map(item => item.location ?? '')].join(' · ');
          const remote = Boolean(job.isRemote) && OPEN_TO_SAUDI.test(places);
          if (!SAUDI.test(places) && !remote) continue;
          out.push(posting({ title: job.title, company: board.company, place: places, remote, hybrid: job.workplaceType === 'Hybrid', description: job.descriptionPlain ?? '', url: job.jobUrl ?? job.applyUrl ?? '', sourceName: `صفحة توظيف ${board.company}`, postedAt: job.publishedAt ?? null }));
        }
      }
    }
    return out;
  },
};

interface RemotiveJob { title: string; company_name: string; url: string; publication_date?: string; candidate_required_location?: string; description?: string; salary?: string }
export const remotive: Connector = {
  name: 'Remotive',
  async search(plan, ctx) {
    const out: Posting[] = [];
    for (const query of plan.queries.slice(0, 2)) {
      // Remotive asks for few requests a day: results are cached.
      const body = await getJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}`, ctx, { cacheHours: 6 }) as { jobs?: RemotiveJob[] };
      for (const job of body.jobs ?? []) {
        if (!OPEN_TO_SAUDI.test(job.candidate_required_location ?? '')) continue;
        out.push(posting({ title: job.title, company: job.company_name, place: '', remote: true, description: stripHtml(job.description ?? ''), url: job.url, sourceName: 'Remotive', postedAt: job.publication_date ?? null, salary: job.salary ?? '' }));
      }
    }
    return out;
  },
};

interface JobicyJob { jobTitle: string; companyName: string; url: string; jobGeo?: string; pubDate?: string; jobExcerpt?: string; jobDescription?: string }
export const jobicy: Connector = {
  name: 'Jobicy',
  async search(plan, ctx) {
    const out: Posting[] = [];
    for (const query of plan.queries.slice(0, 2)) {
      const body = await getJson(`https://jobicy.com/api/v2/remote-jobs?count=30&tag=${encodeURIComponent(query)}`, ctx, { cacheHours: 6 }) as { jobs?: JobicyJob[] };
      for (const job of body.jobs ?? []) {
        if (!OPEN_TO_SAUDI.test(job.jobGeo ?? '')) continue;
        out.push(posting({ title: job.jobTitle, company: job.companyName, place: '', remote: true, description: stripHtml(job.jobDescription ?? job.jobExcerpt ?? ''), url: job.url, sourceName: 'Jobicy', postedAt: job.pubDate ?? null }));
      }
    }
    return out;
  },
};

interface HimalayasJob { title: string; companyName: string; applicationLink?: string; guid?: string; pubDate?: number; description?: string; excerpt?: string; locationRestrictions?: string[] }
export const himalayas: Connector = {
  name: 'Himalayas',
  async search(plan, ctx) {
    const out: Posting[] = [];
    for (const query of plan.queries.slice(0, 2)) {
      const body = await getJson(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(query)}&limit=20`, ctx, { cacheHours: 6 }) as { jobs?: HimalayasJob[] };
      for (const job of body.jobs ?? []) {
        const allowed = job.locationRestrictions ?? [];
        if (allowed.length && !allowed.some(country => /saudi/i.test(country))) continue;
        out.push(posting({ title: job.title, company: job.companyName, place: '', remote: true, description: stripHtml(job.description ?? job.excerpt ?? ''), url: job.applicationLink ?? job.guid ?? '', sourceName: 'Himalayas', postedAt: job.pubDate ? new Date(job.pubDate * 1000).toISOString() : null }));
      }
    }
    return out;
  },
};

interface RemoteOkJob { position?: string; company?: string; url?: string; date?: string; location?: string; description?: string; tags?: string[] }
export const remoteOk: Connector = {
  name: 'Remote OK',
  async search(plan, ctx) {
    const body = await getJson('https://remoteok.com/api', ctx, { cacheHours: 6 }) as RemoteOkJob[];
    const words = new Set(plan.roles.flatMap(role => tokenize(role)).filter(word => word.length > 2));
    return (Array.isArray(body) ? body.slice(1) : [])
      .filter(job => job.position && job.url && (!job.location || /^(remote|worldwide|anywhere)$/i.test(job.location.trim()) || OPEN_TO_SAUDI.test(job.location)))
      .filter(job => tokenize(`${job.position} ${(job.tags ?? []).join(' ')}`).some(word => words.has(word)))
      // Remote OK's terms: link back to the job on Remote OK and name it as the source.
      .map(job => posting({ title: job.position!, company: job.company ?? '', place: '', remote: true, description: stripHtml(job.description ?? ''), url: job.url!, sourceName: 'Remote OK', postedAt: job.date ?? null }));
  },
};

interface Tweet { id: string; text: string; created_at?: string; author_id?: string; entities?: { urls?: { expanded_url?: string }[] } }
const HIRING = /(وظيف|وظائف|توظيف|مطلوب|نوظف|فرصة عمل|hiring|we are hiring|job opening|vacanc|join our team)/i;
export const xSearch: Connector = {
  name: 'X (تويتر)',
  async search(plan, ctx) {
    if (!env.xBearerToken) throw Object.assign(new Error('needs_key'), { needsKey: true });
    const out: Posting[] = [];
    for (const role of plan.roles.slice(0, 2)) {
      const query = `(${role}) (وظيفة OR وظائف OR توظيف OR hiring) (السعودية OR الرياض OR جدة OR الدمام OR Saudi OR KSA OR Riyadh) has:links -is:retweet`;
      const body = await getJson(`https://api.x.com/2/tweets/search/recent?max_results=25&tweet.fields=created_at,entities,author_id&expansions=author_id&user.fields=name,username&query=${encodeURIComponent(query)}`, ctx, { headers: { authorization: `Bearer ${env.xBearerToken}` }, cacheHours: 1 }) as { data?: Tweet[]; includes?: { users?: { id: string; name: string; username: string }[] } };
      const users = new Map((body.includes?.users ?? []).map(user => [user.id, user]));
      for (const tweet of body.data ?? []) {
        if (!HIRING.test(tweet.text)) continue;
        const user = users.get(tweet.author_id ?? '');
        const link = (tweet.entities?.urls ?? []).map(url => url.expanded_url ?? '').find(url => url && !/(^https?:\/\/)?(www\.)?(x|twitter)\.com\//i.test(url));
        const firstLine = tweet.text.split(/[.!؟?|]/)[0]!.replace(/https?:\/\/\S+/g, '').replace(/#/g, '').trim();
        out.push(posting({
          title: clip(firstLine || role, 90), company: user?.name ?? 'X', place: tweet.text, remote: /(عن بعد|عن بُعد|remote)/i.test(tweet.text),
          description: tweet.text.replace(/https?:\/\/\S+/g, '').trim(), url: link ?? `https://x.com/${user?.username ?? 'i'}/status/${tweet.id}`, sourceName: 'X (تويتر)', postedAt: tweet.created_at ?? null,
        }));
      }
    }
    return out;
  },
};

export const CONNECTORS: Connector[] = [workable, careerBoards, xSearch, remotive, jobicy, himalayas, remoteOk];

/* ───────────── The search plan for one CV ───────────── */

const TITLES_EN: [RegExp, string][] = [
  [/محلل بيانات/, 'Data Analyst'], [/محاسب/, 'Accountant'], [/مدقق|مراجع حسابات/, 'Auditor'], [/موارد بشريه|توظيف/, 'HR Specialist'],
  [/مدخل بيانات|ادخال بيانات/, 'Data Entry Clerk'], [/سكرتير|مساعد اداري|منسق اداري|موظف اداري/, 'Administrative Assistant'],
  [/تجربه مستخدم|واجهات/, 'UI/UX Designer'], [/مصمم جرافيك/, 'Graphic Designer'], [/مصمم/, 'Designer'], [/مطور|مبرمج/, 'Software Developer'],
  [/عمليات/, 'Operations Specialist'], [/مهندس مدني/, 'Civil Engineer'], [/مهندس كهرب/, 'Electrical Engineer'],
  [/مهندس ميكانيك/, 'Mechanical Engineer'], [/مهندس/, 'Engineer'], [/ممرض/, 'Nurse'], [/صيدل/, 'Pharmacist'], [/طبيب/, 'Doctor'],
  [/معلم|مدرس/, 'Teacher'], [/مدرب/, 'Trainer'], [/تسويق/, 'Marketing Specialist'], [/خدمه العملاء|دعم العملاء/, 'Customer Support Specialist'],
  [/مبيعات/, 'Sales Representative'], [/امن سيبراني/, 'Cybersecurity Analyst'], [/ذكاء اصطناعي/, 'AI Engineer'], [/فني/, 'Technician'],
  [/مشرف/, 'Supervisor'], [/مستودع|مخازن|لوجست/, 'Logistics Coordinator'], [/مشتريات/, 'Procurement Specialist'], [/قانوني|محامي/, 'Legal Advisor'],
];
// «Data Analyst - Almarai» → «Data Analyst»; «Front-End Developer» keeps its hyphen.
const CLEAN_TITLE = /\b(trainee|intern|internship|co-?op|apprentice|junior|senior|sr\.?|jr\.?)\b|\([^)]*\)|\s[-–—|]\s.*$|,.*$/gi;

/** Search phrases from the CV reading, in English (what job sites index), for any field and level. */
export function searchPlan(profile: Pick<CvProfileView, 'jobTitles' | 'suggestedRoles' | 'searchKeywords' | 'skills' | 'careerLevel' | 'yearsExperience'>): SearchPlan {
  const latin = (value: string) => /[a-z]/i.test(value) && !/[ء-ي]/.test(value);
  const cleaned = (value: string) => value.replace(CLEAN_TITLE, ' ').replace(/\s+/g, ' ').trim();
  const english = (value: string) => {
    if (latin(value)) return cleaned(value);
    const key = normalizeArabic(value);
    return TITLES_EN.find(([pattern]) => pattern.test(key))?.[1] ?? '';
  };
  const roles = uniqueStrings([
    ...profile.jobTitles.map(english), ...profile.suggestedRoles.map(english),
    ...profile.searchKeywords.filter(latin).filter(keyword => pieceKind(keyword) === 'title').map(cleaned),
  ].filter(role => role.length >= 3 && pieceKind(role) === 'title'), 4);
  const tools = profile.skills.filter(skill => latin(skill) && skillGroup(skill) !== 'soft').slice(0, 2);
  const graduate = /حديث/.test(profile.careerLevel ?? '') || (profile.yearsExperience ?? 0) < 1;
  return {
    roles,
    queries: uniqueStrings([...roles, ...tools, ...(graduate ? ['Graduate Program'] : [])], 7),
    graduate,
    senior: (profile.yearsExperience ?? 0) >= 8,
  };
}

/* ───────────── Run all sources, then keep what fits this CV ───────────── */

const SENIOR_TITLE = /\b(senior|sr\.?|lead|principal|head|director|manager|chief|vp|vice president|staff)\b|مدير|رئيس/i;
const ENTRY_TITLE = /\b(intern|internship|trainee|junior|entry[- ]level|graduate)\b|متدرب/i;

export interface SourceSearchResult { postings: Posting[]; reports: SourceReport[]; fetched: number }

export async function searchSources(plan: SearchPlan, now = new Date()): Promise<SourceSearchResult> {
  const ctx: Context = { fetch: settings.fetch ?? fetch, now };
  const settled = await Promise.all(CONNECTORS.map(async connector => {
    try {
      const found = await connector.search(plan, ctx);
      return { connector, found, report: { source: connector.name, status: (found.length ? 'results' : 'no_results') as SourceStatus, note: found.length ? `${found.length} إعلانًا` : 'لا إعلانات مطابقة لعبارات البحث', count: found.length } };
    } catch (error) {
      const needsKey = (error as { needsKey?: boolean }).needsKey;
      return { connector, found: [] as Posting[], report: { source: connector.name, status: (needsKey ? 'needs_key' : 'unreachable') as SourceStatus, note: needsKey ? 'منصة X لا تسمح بالبحث إلا بمفتاح X API (X_BEARER_TOKEN)' : `تعذّر الوصول (${error instanceof Error ? error.message : 'خطأ'})`, count: 0 } };
    }
  }));
  const fresh = (postedAt: string | null) => !postedAt || !Number.isFinite(Date.parse(postedAt)) || now.getTime() - Date.parse(postedAt) <= MAX_AGE_DAYS * 86_400_000;
  // One entry per job: the same posting found by two search phrases, or in several cities, or on two sites.
  const seen = new Set<string>();
  const postings = settled.flatMap(item => item.found)
    .filter(item => item.title && item.company && /^https?:\/\//.test(item.sourceUrl) && fresh(item.postedAt) && !VOICE_HEAVY.test(`${item.title} ${item.description}`))
    .filter(item => {
      const keys = [item.sourceUrl.split('?')[0]!.toLowerCase(), `${normalizeArabic(item.title)}|${normalizeArabic(item.company)}`];
      if (keys.some(key => seen.has(key))) return false;
      keys.forEach(key => seen.add(key));
      return true;
    });
  return { postings, reports: settled.map(item => item.report), fetched: settled.reduce((sum, item) => sum + item.found.length, 0) };
}

/**
 * Keeps the postings that really fit this CV: right level, at least one required skill in common
 * (or the same kind of role), and a match score of 40% or more — best first.
 */
// Tools almost every job lists: sharing only these does not make a job fit.
const GENERIC = new Set(['Excel', 'Microsoft Office', 'Word', 'PowerPoint', 'Outlook وTeams', 'Google Workspace', 'ERP', 'إعداد التقارير', 'الطباعة السريعة']);

export function rankForCandidate(postings: Posting[], profile: CvProfileView, cvText: string, plan: SearchPlan, limit = 30) {
  const roleWords = new Set([...plan.roles, ...profile.jobTitles, ...profile.suggestedRoles].flatMap(titleTokens));
  return postings
    .filter(item => !(plan.graduate && SENIOR_TITLE.test(item.title)) && !(plan.senior && ENTRY_TITLE.test(item.title)))
    .map(item => {
      const match = matchJob(profile, item, cvText);
      const sameRole = titleTokens(item.title).some(word => roleWords.has(word));
      const realSkills = match.matchedSkills.some(skill => skillGroup(skill) !== 'soft' && !GENERIC.has(canonicalSkill(skill)));
      return { item, match, sameRole, realSkills, rank: match.score + (sameRole ? 12 : 0) };
    })
    .filter(entry => entry.match.score >= 40 && (entry.sameRole || entry.realSkills))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit);
}
