// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Full HTTP flow against an in-memory PostgreSQL (PGlite): sign-up, CV agent, matching,
 * applications timeline, interview agent with 👍/👎 and automatic interpreter, report.
 */
process.env['PGLITE_DIR'] = 'memory://';
process.env['SANAD_DISABLE_LLM'] = '1';
process.env['JOBS_AGENT_INTERVAL_HOURS'] = '0';

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

async function docx(text: string): Promise<File> {
  // Minimal .docx: the CV agent reads word/document.xml through mammoth.
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text.split(/\r?\n/).map(line => `<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  return new File([bytes], 'cv.docx');
}

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

    // Applying needs an analysed CV.
    expect((await call('POST', '/applications', { jobId: 'analyst' })).body['error'].code).toBe('cv_required');
    const form = new FormData();
    form.append('file', await docx('محلل بيانات - شركة نماء - 2020 - 2024: Excel و SQL وPower BI وتحليل البيانات\nبكالوريوس إحصاء - جامعة الملك عبدالعزيز'));
    expect((await call('POST', '/cv', form)).status).toBe(200);
    expect((await call('POST', '/cv/analyse')).body['status']).toBe('analysing');
    let status = '';
    for (let attempt = 0; attempt < 40 && status !== 'analysed'; attempt += 1) {
      status = (await call('GET', '/cv')).body['cv'].status;
      if (status === 'failed') throw new Error(`CV analysis failed: ${(await call('GET', '/cv')).body['cv'].error}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const state = (await call('GET', '/me/state')).body;
    expect(state['cvProfile'].skills).toEqual(expect.arrayContaining(['Excel', 'SQL', 'Power BI']));
    const analyst = state['jobs'].find((job: { id: string }) => job.id === 'analyst');
    expect(analyst.match).toBeGreaterThan(90);
    expect(analyst.matchReason).toContain('Excel');

    // Timeline: apply → nominate (auto-scheduled interview) ; employer-only steps are refused.
    expect((await call('POST', '/applications', { jobId: 'analyst' })).status).toBe(200);
    expect((await call('POST', '/applications/analyst/status', { status: 'accepted' })).status).toBe(403);
    expect((await call('POST', '/applications/analyst/status', { status: 'nominated' })).status).toBe(200);
    const nominated = (await call('GET', '/me/state')).body;
    expect(nominated['applications']['analyst']).toBe('nominated');
    expect(nominated['applicationHistory']['analyst'].map((event: { status: string }) => event.status)).toEqual(['applied', 'nominated']);
    expect(Date.parse(nominated['schedules']['analyst'])).toBeGreaterThan(Date.now());

    // The real interview opens only at its time.
    expect((await call('POST', '/interviews', { jobId: 'analyst', preview: false })).status).toBe(409);
    expect((await call('PUT', '/jobs/analyst/schedule', { startsAt: new Date(Date.now() - 60_000).toISOString() })).status).toBe(200);
    const started = await call('POST', '/interviews', { jobId: 'analyst', preview: false, communication: 'sign' });
    expect(started.status).toBe(200);
    const sessionId = started.body['sessionId'] as string;
    const recruiter = { 'x-recruiter-token': started.body['recruiterToken'] as string };

    // Recruiter (second device, link token) asks; Sanad simplifies and builds the sign playlist.
    const savedCookie = cookie; cookie = '';
    const question = await call('POST', `/interviews/${sessionId}/questions`, { text: 'هل يمكنك أن تحدثنا عن أبرز إنجاز حققته خلال مسيرتك المهنية؟' }, recruiter);
    expect(question.status).toBe(200);
    expect(question.body['simple']).toBe('احكِ عن أبرز إنجاز حققته في عملك؟');
    expect(question.body['playlist'].length).toBeGreaterThan(0);
    expect((await call('POST', `/interviews/${sessionId}/questions`, { text: 'x' }, { 'x-recruiter-token': 'wrong' })).status).toBe(403);
    cookie = savedCookie;

    // Two unclear signing attempts → the backup interpreter joins automatically.
    const blank = Buffer.alloc(3000, 1).toString('base64');
    const first = await call('POST', `/interviews/${sessionId}/answers/recognize`, { questionId: question.body['id'], frames: [blank, blank, blank] });
    expect(first.body).toMatchObject({ understood: false, misunderstandings: 1, interpreter: 'standby' });
    const second = await call('POST', `/interviews/${sessionId}/answers/recognize`, { questionId: question.body['id'], frames: [blank, blank, blank] });
    expect(second.body).toMatchObject({ understood: false, misunderstandings: 2, interpreter: 'joined' });

    // Draft is private until 👍.
    const draft = await call('POST', `/interviews/${sessionId}/answers/text`, { questionId: question.body['id'], text: 'رفعت دقة تقارير المبيعات إلى ٩٩٪.' });
    cookie = '';
    expect((await call('GET', `/interviews/${sessionId}`, undefined, recruiter)).body['answers']).toEqual([]);
    cookie = savedCookie;
    expect((await call('POST', `/interviews/${sessionId}/answers/${draft.body['answerId']}/decision`, { approved: true })).body['status']).toBe('approved');
    cookie = '';
    const recruiterView = (await call('GET', `/interviews/${sessionId}`, undefined, recruiter)).body;
    expect(recruiterView['answers'].map((answer: { text: string }) => answer.text)).toEqual(['رفعت دقة تقارير المبيعات إلى ٩٩٪.']);
    expect(recruiterView['interpreter']).toBe('joined');
    const events = (await call('GET', `/interviews/${sessionId}/events?after=0`, undefined, recruiter)).body['events'].map((event: { type: string }) => event.type);
    expect(events).toEqual(['session_started', 'question', 'misunderstanding', 'misunderstanding', 'interpreter_joined', 'answer_approved']);
    cookie = savedCookie;

    // Ending saves a report with approved answers only and completes the application.
    const ended = await call('POST', `/interviews/${sessionId}/end`, { durationSeconds: 240 });
    expect(ended.body['reportId']).toMatch(/^report-/);
    const final = (await call('GET', '/me/state')).body;
    expect(final['applications']['analyst']).toBe('completed');
    expect(final['reports'][0]).toMatchObject({ jobId: 'analyst', durationSeconds: 240, answers: ['رفعت دقة تقارير المبيعات إلى ٩٩٪.'] });

    // Sign-out ends the session; data stays in the database for the next sign-in.
    await call('POST', '/auth/logout');
    expect((await call('GET', '/me/state')).status).toBe(401);
    expect((await call('POST', '/auth/login', { email: 'renad@example.com', password: 'nope1234' })).status).toBe(401);
    const back = await call('POST', '/auth/login', { email: 'RENAD@example.com', password: 'secret123' });
    expect(back.body['snapshot'].applications['analyst']).toBe('completed');
  }, 60_000);

  it('jobs agent: records verified postings through its tool, rejects bad ones, and personalises for a CV', async () => {
    const { discoverForUser, discoverWithClaude } = await import('@/server/agents/jobs/jobs-agent');
    const posting = {
      title: 'محلل بيانات مبتدئ', english: 'Junior Data Analyst', company: 'شركة رؤى للبيانات', location: 'الرياض', mode: 'هجين' as const,
      salary: '٩٬٠٠٠ ر.س', description: 'إعداد تقارير المبيعات ولوحات Power BI والتواصل مع الفريق كتابيًا.', skills: ['Excel', 'Power BI', 'SQL'],
      sourceUrl: 'https://careers.example.sa/jobs/analyst-42', sourceName: 'موقع الشركة', postedAt: '2026-11-10', deadline: '2027-01-31',
      deafFriendlyReason: 'الإعلان مفتوح لذوي الإعاقة ضمن برنامج توافق، والتواصل كتابي.', accommodations: ['مقابلة بمترجم لغة إشارة'],
    };
    const replies: string[] = [];
    // Stands in for Claude: the runner gives the model our record_job tool; the model calls it per posting.
    const fakeClaude = { beta: { messages: { toolRunner: (params: { tools: { name?: string; run?: (input: unknown) => Promise<string> }[] }) => ({
      runUntilDone: async () => {
        const recordJob = params.tools.find(tool => tool.name === 'record_job')!;
        replies.push(await recordJob.run!(posting));
        replies.push(await recordJob.run!(posting));
        replies.push(await recordJob.run!({ ...posting, title: 'وظيفة بلا رابط', sourceUrl: 'not-a-url' }));
        replies.push(await recordJob.run!({ ...posting, title: 'إعلان منتهي', sourceUrl: 'https://careers.example.sa/old', deadline: '2020-01-01' }));
        return { stop_reason: 'end_turn', content: [] };
      },
    }) } } } as never;

    const result = await discoverWithClaude({ queries: ['وظائف ذوي الإعاقة'], limit: 10, client: fakeClaude });
    expect(result).toMatchObject({ saved: 1, duplicates: 1, rejected: 2 });
    expect(replies).toEqual(['تم الحفظ.', 'هذا الإعلان محفوظ مسبقًا؛ ابحث عن غيره.', 'رُفض: رابط غير صالح. سجّل إعلانًا كاملًا برابط صحيح.', 'رُفض: انتهى موعد التقديم. سجّل إعلانًا كاملًا برابط صحيح.']);

    // The new job appears for the candidate with all the usual features and a CV match.
    const state = (await call('GET', '/me/state')).body;
    const found = state['jobs'].find((job: { title: string }) => job.title === 'محلل بيانات مبتدئ');
    expect(found).toMatchObject({ company: 'شركة رؤى للبيانات', source: 'agent', sourceUrl: 'https://careers.example.sa/jobs/analyst-42' });
    expect(found.match).toBeGreaterThan(80);
    expect((await call('POST', '/applications', { jobId: found.id })).status).toBe(200);

    // Personalised search runs once, then waits 12 hours.
    expect((await discoverForUser(state['user'].id, fakeClaude)).status).toBe('done');
    expect((await discoverForUser(state['user'].id, fakeClaude)).status).toBe('skipped');
  }, 60_000);
});
