// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Full HTTP flow against an in-memory PostgreSQL (PGlite): sign-up, CV agent (ATS reading, tracked
 * stages), jobs from the jobs agent, matching, applications timeline, interview schedule and report,
 * and files the system must refuse or fail gracefully on.
 */
process.env['PGLITE_DIR'] = 'memory://';
process.env['SANAD_DISABLE_LLM'] = '1';
process.env['JOBS_AGENT_INTERVAL_HOURS'] = '0';

const NL = String.fromCharCode(10);
let handle: (request: Request) => Promise<Response>;
let cookie = '';

async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const isForm = body instanceof FormData;
  const response = await handle(new Request(`http://localhost:3000/api${path}`, {
    method,
    headers: { 'x-sanad-client': 'web', origin: 'http://localhost:3000', ...(cookie ? { cookie } : {}), ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}), ...extra },
    body: body === undefined ? null : isForm ? body : JSON.stringify(body),
  }));
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0]!.endsWith('=') ? '' : setCookie.split(';')[0]!;
  return { status: response.status, body: await response.json() as Record<string, any> };
}

async function docx(text: string, name = 'cv.docx'): Promise<File> {
  // Minimal .docx: the CV agent reads word/document.xml through mammoth.
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text.split(NL).map(line => `<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  return new File([bytes], name);
}

async function analyse(file: File) {
  const form = new FormData();
  form.append('file', file);
  const upload = await call('POST', '/cv', form);
  if (upload.status !== 200) return { upload, cv: null };
  await call('POST', '/cv/analyse');
  let cv: Record<string, any> | null = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    cv = (await call('GET', '/cv')).body['cv'];
    if (cv?.['status'] === 'analysed' || cv?.['status'] === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return { upload, cv };
}

const posting = (overrides: Record<string, unknown> = {}) => ({
  title: 'محلل بيانات', english: 'Data Analyst', company: 'شركة نماء للتحليلات', location: 'الرياض', mode: 'هجين' as const,
  salary: '', description: 'تحليل بيانات المبيعات باستخدام Excel وSQL وبناء لوحات Power BI، والتواصل مع الفريق كتابيًا.', skills: ['Excel', 'SQL', 'Power BI', 'تحليل البيانات'],
  sourceUrl: 'https://careers.example.sa/jobs/data-analyst-7', sourceName: 'موقع الشركة', postedAt: '2026-11-10', deadline: '2027-01-31',
  deafFriendlyReason: 'الإعلان مفتوح لذوي الإعاقة والتواصل كتابي.', accommodations: [] as string[], ...overrides,
});

beforeAll(async () => {
  handle = (await import('@/server/http/api')).handleApiRequest;
}, 60_000);
afterAll(async () => { await (await import('@/server/db/client')).resetDbForTests(); });

describe('Sanad REST API', () => {
  it('rejects state-changing requests without the client header or from another origin', async () => {
    const missing = await handle(new Request('http://localhost:3000/api/auth/login', { method: 'POST', body: '{}' }));
    expect(missing.status).toBe(403);
    const foreign = await call('POST', '/auth/login', { email: 'a@b.co', password: 'x' }, { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
  });

  it('runs the candidate journey end to end', async () => {
    const signup = await call('POST', '/auth/signup', { name: 'ريناد', email: 'Renad@Example.com', password: 'secret123' });
    expect(signup.status).toBe(200);
    expect(signup.body['snapshot'].user).toMatchObject({ name: 'ريناد', email: 'renad@example.com', role: 'candidate' });
    expect(cookie).toMatch(/^sanad_session=/);
    expect((await call('POST', '/auth/signup', { name: 'x', email: 'renad@example.com', password: 'secret123' })).status).toBe(409);
    // The built-in demo jobs are never shown to an account as real results.
    expect(signup.body['snapshot'].jobs.filter((job: { source?: string }) => job.source === 'sanad')).toEqual([]);

    // A real posting (as the jobs agent stores it).
    const { ingestPostings } = await import('@/server/agents/jobs/jobs-agent');
    expect(await ingestPostings([posting()], 'agent')).toMatchObject({ created: 1 });
    const jobId = (await call('GET', '/me/state')).body['jobs'].find((job: { title: string }) => job.title === 'محلل بيانات').id as string;

    // Applying needs an analysed CV.
    expect((await call('POST', '/applications', { jobId })).body['error'].code).toBe('cv_required');
    const { cv } = await analyse(await docx(['محلل بيانات - شركة نماء - 2020 - 2024: Excel و SQL وPower BI وتحليل البيانات', 'بكالوريوس إحصاء - جامعة الملك عبدالعزيز'].join(NL)));
    expect(cv?.['status']).toBe('analysed');
    const state = (await call('GET', '/me/state')).body;
    expect(state['cvProfile'].skills).toEqual(expect.arrayContaining(['Excel', 'SQL', 'Power BI']));
    expect(state['cvProfile'].experience).toEqual(['محلل بيانات · شركة نماء · ٤ سنوات']);
    expect(state['cvProfile'].ats.score).toBeGreaterThan(0);
    const job = state['jobs'].find((item: { id: string }) => item.id === jobId);
    expect(job.match).toBeGreaterThan(85);
    expect(job.matchReason).toContain('Excel');
    expect(job).toMatchObject({ sourceUrl: 'https://careers.example.sa/jobs/data-analyst-7', sourceName: 'موقع الشركة' });

    // Every stage of the workflow is tracked, with the reason when one is skipped.
    const pipeline = (await call('GET', '/pipeline')).body;
    expect(pipeline['analysis'].status).toBe('succeeded');
    expect(Object.fromEntries(pipeline['analysis'].stages.map((stage: { name: string; status: string }) => [stage.name, stage.status])))
      .toEqual({ extract: 'done', read: 'done', ai: 'skipped', titles: 'done', match: 'done', job_search: 'skipped' });
    expect(pipeline['analysis'].stages.find((stage: { name: string }) => stage.name === 'job_search').detail).toContain('ANTHROPIC_API_KEY');
    expect(pipeline['webSearchEnabled']).toBe(false);

    // The full ATS reading.
    const ats = (await call('GET', '/cv/ats')).body;
    expect(ats['ats'].checks.length).toBeGreaterThan(10);
    expect(ats['ats'].tips.length).toBeGreaterThan(0);

    // Timeline: apply → nominate (auto-scheduled interview) ; employer-only steps are refused.
    expect((await call('POST', '/applications', { jobId })).status).toBe(200);
    expect((await call('POST', `/applications/${jobId}/status`, { status: 'accepted' })).status).toBe(403);
    expect((await call('POST', `/applications/${jobId}/status`, { status: 'nominated' })).status).toBe(200);
    const nominated = (await call('GET', '/me/state')).body;
    expect(nominated['applications'][jobId]).toBe('nominated');
    expect(nominated['applicationHistory'][jobId].map((event: { status: string }) => event.status)).toEqual(['applied', 'nominated']);
    expect(Date.parse(nominated['schedules'][jobId])).toBeGreaterThan(Date.now());

    // The candidate can move the interview; the date is saved with the job.
    const moved = new Date(Date.now() + 5 * 86_400_000).toISOString();
    expect((await call('PUT', `/jobs/${jobId}/schedule`, { startsAt: moved })).status).toBe(200);
    expect((await call('GET', '/me/state')).body['schedules'][jobId]).toBe(moved);

    // The interview room runs in the browser (no live interview agent on the server).
    expect((await call('POST', '/interviews', { jobId })).status).toBe(404);

    // Finishing it saves a report with the answers the candidate approved and completes the application.
    const answers = ['رفعت دقة تقارير المبيعات إلى ٩٩٪.'];
    const questions = ['حدثنا عن أبرز إنجاز حققته في عملك.'];
    const report = await call('POST', '/reports', { jobId, answers, questions, durationSeconds: 240 });
    expect(report.body['reportId']).toMatch(/^report-/);
    const final = (await call('GET', '/me/state')).body;
    expect(final['applications'][jobId]).toBe('completed');
    expect(final['reports'][0]).toMatchObject({ jobId, durationSeconds: 240, answers, questions });
    expect((await call('POST', '/reports', { jobId, answers, questions, durationSeconds: 10 })).status).toBe(409);

    // Sign-out ends the session; data stays in the database for the next sign-in.
    await call('POST', '/auth/logout');
    expect((await call('GET', '/me/state')).status).toBe(401);
    expect((await call('POST', '/auth/login', { email: 'renad@example.com', password: 'nope1234' })).status).toBe(401);
    const back = await call('POST', '/auth/login', { email: 'RENAD@example.com', password: 'secret123' });
    expect(back.body['snapshot'].applications[jobId]).toBe('completed');
  }, 60_000);

  it('jobs agent: records verified postings, reports each source honestly, rejects dead links and duplicates across sites', async () => {
    const { discoverForUser, discoverWithClaude } = await import('@/server/agents/jobs/jobs-agent');
    const junior = posting({ title: 'محلل بيانات مبتدئ', english: 'Junior Data Analyst', company: 'شركة رؤى للبيانات', sourceUrl: 'https://careers.example.sa/jobs/analyst-42', description: 'إعداد تقارير المبيعات ولوحات Power BI والتواصل مع الفريق كتابيًا.', skills: ['Excel', 'Power BI', 'SQL'] });
    const replies: string[] = [];
    // Stands in for Claude: the runner gives the model our tools; the model calls them.
    const fakeClaude = { beta: { messages: { toolRunner: (params: { tools: { name?: string; run?: (input: unknown) => Promise<string> }[] }) => ({
      runUntilDone: async () => {
        const tool = (name: string) => params.tools.find(item => item.name === name)!;
        replies.push(await tool('record_job').run!(junior));
        replies.push(await tool('record_job').run!(junior));
        // The same job on another site (different link): listed once.
        replies.push(await tool('record_job').run!({ ...junior, sourceUrl: 'https://sa.linkedin.com/jobs/view/123', sourceName: 'LinkedIn' }));
        replies.push(await tool('record_job').run!({ ...junior, title: 'وظيفة بلا رابط', sourceUrl: 'not-a-url' }));
        replies.push(await tool('record_job').run!({ ...junior, title: 'إعلان منتهي', sourceUrl: 'https://careers.example.sa/old', deadline: '2020-01-01' }));
        replies.push(await tool('record_job').run!({ ...junior, title: 'إعلان محذوف', sourceUrl: 'https://careers.example.sa/closed-9' }));
        await tool('report_source').run!({ source: 'LinkedIn Jobs', status: 'results', note: 'وُجدت إعلانات.' });
        await tool('report_source').run!({ source: 'جدارات', status: 'unreachable', note: 'الصفحة لم تُحمّل.' });
        return { stop_reason: 'end_turn', content: [] };
      },
    }) } } } as never;
    const checkLink = async (url: string) => url.includes('closed') ? 'dead' as const : 'ok' as const;

    const result = await discoverWithClaude({ queries: ['وظائف ذوي الإعاقة'], limit: 10, client: fakeClaude, checkLink });
    expect(result).toMatchObject({ saved: 1, duplicates: 2, rejected: 3 });
    expect(replies).toEqual([
      'تم الحفظ.', 'هذا الإعلان محفوظ مسبقًا؛ ابحث عن غيره.', 'هذا الإعلان محفوظ مسبقًا؛ ابحث عن غيره.',
      'رُفض: رابط غير صالح. سجّل إعلانًا كاملًا برابط صحيح.', 'رُفض: انتهى موعد التقديم. سجّل إعلانًا كاملًا برابط صحيح.',
      'رُفض: رابط الإعلان لا يعمل (غير موجود). سجّل إعلانًا مفتوحًا برابط صحيح.',
    ]);
    expect(result.sources).toEqual([
      { source: 'LinkedIn Jobs', status: 'results', note: 'وُجدت إعلانات.' },
      { source: 'جدارات', status: 'unreachable', note: 'الصفحة لم تُحمّل.' },
    ]);

    // The new job appears for the candidate with all the usual features, its original link and a real match.
    const state = (await call('GET', '/me/state')).body;
    const found = state['jobs'].filter((job: { title: string }) => job.title === 'محلل بيانات مبتدئ');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ company: 'شركة رؤى للبيانات', source: 'agent', sourceUrl: 'https://careers.example.sa/jobs/analyst-42' });
    expect(found[0].match).toBeGreaterThan(75);
    expect((await call('POST', '/applications', { jobId: found[0].id })).status).toBe(200);

    // Personalised search runs once, then waits 12 hours; the run is recorded with its sources.
    expect((await discoverForUser(state['user'].id, fakeClaude)).status).toBe('done');
    expect(await discoverForUser(state['user'].id, fakeClaude)).toMatchObject({ status: 'skipped', reason: 'بُحث لهذا الحساب خلال آخر ١٢ ساعة' });
    const pipeline = (await call('GET', '/pipeline')).body;
    expect(pipeline['jobSearch'].status).toBe('succeeded');
    expect(pipeline['jobSearch'].sources.map((source: { status: string }) => source.status)).toEqual(['results', 'unreachable']);
  }, 60_000);

  it('refuses unsupported files and fails gracefully on unreadable ones', async () => {
    await call('POST', '/auth/signup', { name: 'سارة', email: 'sara@example.com', password: 'secret123' });
    // Wrong type, and a «PDF» that is not one.
    expect((await analyse(new File(['hello'], 'cv.txt'))).upload).toMatchObject({ status: 400 });
    expect((await analyse(new File(['not really a pdf'], 'cv.pdf'))).upload.body['error'].code).toBe('invalid_cv');
    // A real PDF header with no text inside (like a scan, without Claude to read it).
    const empty = await analyse(new File([['%PDF-1.4', '1 0 obj << /Type /Catalog >> endobj', 'trailer << /Root 1 0 R >>', '%%EOF'].join(NL)], 'scan.pdf'));
    expect(empty.cv).toMatchObject({ status: 'failed', error: 'تعذّر قراءة نص السيرة (قد تكون صورة ممسوحة). ارفع ملفًا نصيًا PDF أو Word.' });
    expect((await call('GET', '/pipeline')).body['analysis'].stages[0]).toMatchObject({ name: 'extract', status: 'failed' });
    // A document that is not a CV.
    const notCv = await analyse(await docx('مرحبًا، هذه رسالة قصيرة بلا أي محتوى مهني يُذكر، شكرًا لكم على حسن التعاون والاهتمام الدائم.'));
    expect(notCv.cv).toMatchObject({ status: 'failed', error: 'لم نجد مهارات أو خبرات واضحة في الملف. تأكد أنه سيرة ذاتية.' });
    // The server is still fine and the account still works.
    expect((await call('GET', '/me/state')).status).toBe(200);
  }, 60_000);
});
