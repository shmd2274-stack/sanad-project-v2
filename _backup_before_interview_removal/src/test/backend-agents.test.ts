// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { heuristicProfile } from '@/server/agents/cv/heuristic';
import { matchJob } from '@/server/agents/jobs/matching';
import { fingerprintOf } from '@/server/agents/jobs/jobs-agent';
import { simplifyWithRules } from '@/server/agents/interview/simplify';
import { loadLexicon, parseCsv, textToSigns } from '@/server/agents/interview/ssl-lexicon';
import { canonicalSkill, findSkills } from '@/server/agents/skills-taxonomy';
import { arabicVariants, normalizeArabic } from '@/server/text/arabic';
import { jobs } from '@/lib/sanad-data';

const NOW = new Date('2026-11-18T09:00:00Z');

const CV = `نورة العتيبي
محللة بيانات بخبرة 3 سنوات في تحليل المبيعات وإعداد التقارير.
الخبرات العملية
محلل بيانات - شركة المراعي - 2022 - الآن: تنظيف بيانات المبيعات باستخدام Excel و SQL وبناء لوحات Power BI.
أخصائي إدخال بيانات - بنك الرياض - 2021 - 2022: إدخال البيانات والأرشفة.
التعليم
بكالوريوس نظم المعلومات - جامعة الملك سعود - 2021
اللغات: العربية، الإنجليزية، لغة الإشارة السعودية`;

describe('Arabic text helpers', () => {
  it('folds spelling variants, diacritics and digits', () => {
    expect(normalizeArabic('إدارةُ المشاريعِ ٢٠٢٤')).toBe('اداره المشاريع 2024');
    expect(arabicVariants('والبيانات')).toContain('بيانات');
  });
});

describe('Passwords', () => {
  it('hashes with a per-password salt and verifies', async () => {
    const first = await hashPassword('secret123');
    const second = await hashPassword('secret123');
    expect(first).not.toBe(second);
    expect(await verifyPassword('secret123', first)).toBe(true);
    expect(await verifyPassword('wrong', first)).toBe(false);
  });
});

describe('CV agent (offline engine)', () => {
  it('extracts skills, dated experience, education and languages without false positives', () => {
    const profile = heuristicProfile(CV, NOW);
    expect(profile.skills).toEqual(expect.arrayContaining(['Excel', 'SQL', 'Power BI', 'تحليل البيانات', 'إعداد التقارير']));
    // Section headings and "تحليل المبيعات" must not become teaching / selling skills.
    expect(profile.skills).not.toContain('التعليم والتدريب');
    expect(profile.skills).not.toContain('البيع والمبيعات');
    expect(profile.experience).toEqual([
      'محلل بيانات · شركة المراعي · ٢٠٢٢ – الآن (٤ سنوات) — تنظيف بيانات المبيعات باستخدام Excel و SQL وبناء لوحات Power BI',
      'أخصائي إدخال بيانات · بنك الرياض · ٢٠٢١ – ٢٠٢٢ (سنة) — إدخال البيانات والأرشفة',
    ]);
    expect(profile.education[0]).toContain('بكالوريوس');
    expect(profile.languages).toContain('لغة الإشارة السعودية');
    // Computed from the dates (2021 → today), not copied from the self-description.
    expect(profile.yearsExperience).toBe(5);
  });
  it('maps skill spellings to one canonical name', () => {
    expect(canonicalSkill('اكسل')).toBe('Excel');
    expect(canonicalSkill('Microsoft Excel')).toBe('Excel');
    expect(findSkills('خبرة في خدمة العملاء وZendesk')).toEqual(expect.arrayContaining(['خدمة العملاء', 'CRM']));
  });
});

describe('Job matching', () => {
  it('ranks the data job above design and explains why in Arabic', () => {
    const profile = heuristicProfile(CV, NOW);
    const [analyst, , designer] = jobs;
    const good = matchJob(profile, analyst);
    const weak = matchJob(profile, designer);
    expect(good.score).toBeGreaterThan(90);
    expect(weak.score).toBeLessThan(40);
    expect(good.reason).toContain('Excel');
    expect(good.matchedSkills).toEqual(expect.arrayContaining(['Excel', 'SQL']));
  });
  it('fingerprints the same posting identically', () => {
    const a = fingerprintOf({ title: 'مُدخِل بيانات', company: 'شركة أ', sourceUrl: 'https://example.com/jobs/1?ref=x' });
    const b = fingerprintOf({ title: 'مدخل بيانات', company: 'شركه ا', sourceUrl: 'https://EXAMPLE.com/jobs/1' });
    expect(a).toBe(b);
  });
});

describe('Interview agent', () => {
  it('simplifies a long recruiter question without changing it into a different one', () => {
    expect(simplifyWithRules('هل يمكنك أن تحدثنا عن أبرز إنجاز حققته خلال مسيرتك المهنية؟').simple).toBe('احكِ عن أبرز إنجاز حققته في عملك؟');
    // Known questions use their approved simple wording.
    expect(simplifyWithRules('ما الذي جذبك إلى هذه الوظيفة؟')).toMatchObject({ simple: 'لماذا تريد العمل في هذه الوظيفة؟', engine: 'catalog' });
  });
  it('parses quoted CSV fields with commas and new lines', () => {
    expect(parseCsv('a,b\n"x, y","line1\nline2"\n')).toEqual([{ a: 'x, y', b: 'line1\nline2' }]);
  });
  it.skipIf(!loadLexicon())('translates interview questions into real SSL sign videos', () => {
    const playlist = textToSigns('احكِ عن مشروع استخدمت فيه البيانات. كيف تعاونت مع فريقك؟');
    expect(playlist.every(clip => clip.kind === 'word' && clip.videoId?.startsWith('ssl_') && clip.url)).toBe(true);
    expect(playlist.map(clip => clip.gloss)).toEqual(['احك', 'مشروع', 'استخدمت', 'البيانات', 'كيف', 'تعاونت', 'مع', 'فريقك']);
    expect(textToSigns('صباح الخير، كيف حالك؟').map(clip => clip.gloss)).toEqual(['صباح الخير', 'كيف حالك']);
  });
});
