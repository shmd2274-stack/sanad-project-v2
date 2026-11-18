// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { durationAr, findDateRange, formatExperience, parseExperience, totalYears } from '@/server/agents/cv/experience';
import { heuristicProfile } from '@/server/agents/cv/heuristic';
import { mergeProfiles, supportedByText, verifiedClaudeProfile } from '@/server/agents/cv/cv-agent';
import { splitSections } from '@/server/agents/cv/sections';
import { parseFeed } from '@/server/agents/jobs/jobs-agent';
import { skillsMatch } from '@/server/agents/jobs/matching';

const NOW = new Date('2026-11-18T09:00:00Z');

const ENGLISH_CV = `KHALID AL-HARBI
Riyadh, Saudi Arabia · khalid@example.com
PROFESSIONAL SUMMARY
Customer service specialist with strong written communication and CRM experience.
WORK EXPERIENCE
Customer Support Specialist
STC Solutions | Riyadh
Mar 2023 – Present
• Resolved 60+ chat and email tickets daily using Zendesk with 95% satisfaction.
• Trained 4 new agents on written support guidelines.
Call Center Agent (chat)
Jarir Bookstore, Jeddah
06/2021 - 02/2023
- Handled online orders and returns through live chat.
EDUCATION
Diploma in Business Administration – Riyadh College of Technology – 2020
SKILLS
Zendesk • Salesforce • MS Office (Advanced) • Typing 60 WPM • Problem solving
LANGUAGES
Arabic (Native), English (Fluent)`;

const NURSE_CV = `أمل الشهري — ممرضة
خبرة في مستشفى الملك فهد التخصصي بالدمام من 1440هـ إلى 1445هـ في رعاية المرضى وتسجيل السجلات الطبية.
متدربة تمريض في مستشفى الحرس الوطني 2018 - 2019
دبلوم التمريض، كلية الأمير سلطان للعلوم الصحية 2018
BLS, ACLS, مكافحة العدوى، رعاية المرضى`;

describe('Reading experience like a recruiter', () => {
  it('finds date ranges in Arabic, English, numeric and Hijri forms', () => {
    expect(findDateRange('محلل بيانات - 2022 - الآن')).toMatchObject({ start: '2022', current: true });
    expect(findDateRange('Mar 2023 – Present')).toMatchObject({ start: '2023-03', current: true });
    expect(findDateRange('06/2021 - 02/2023')).toMatchObject({ start: '2021-06', end: '2023-02', current: false });
    expect(findDateRange('من يناير ٢٠٢٠ إلى مارس ٢٠٢١')).toMatchObject({ start: '2020-01', end: '2021-03' });
    expect(findDateRange('من 1440هـ إلى 1445هـ')).toMatchObject({ start: '2019', end: '2024' });
    expect(findDateRange('منذ 2019')).toMatchObject({ start: '2019', current: true });
  });

  it('writes durations in natural Arabic', () => {
    expect(durationAr(1)).toBe('شهر');
    expect(durationAr(14)).toBe('سنة وشهران');
    expect(durationAr(24)).toBe('سنتان');
    expect(durationAr(45)).toBe('٣ سنوات و٩ أشهر');
    expect(durationAr(144)).toBe('١٢ سنة');
  });

  it('reads multi-line English roles: title, company, city, dates, achievements', () => {
    const profile = heuristicProfile(ENGLISH_CV, NOW);
    expect(profile.experience).toEqual([
      'Customer Support Specialist · STC Solutions، Riyadh · مارس ٢٠٢٣ – الآن (٣ سنوات و٩ أشهر) — Resolved 60+ chat and email tickets daily using Zendesk with 95% satisfaction',
      'Call Center Agent (chat) · Jarir Bookstore، Jeddah · يونيو ٢٠٢١ – فبراير ٢٠٢٣ (سنة و٩ أشهر) — Handled online orders and returns through live chat',
    ]);
    expect(profile.experienceDetails[0]).toMatchObject({ title: 'Customer Support Specialist', organization: 'STC Solutions', location: 'Riyadh', current: true, duration: '٣ سنوات و٩ أشهر' });
    expect(profile.experienceDetails[0]?.highlights).toHaveLength(2);
    expect(profile.yearsExperience).toBe(5.5);
    expect(profile.careerLevel).toBe('متوسط الخبرة');
  });

  it('keeps the candidate’s own tool names, Arabic names for concepts, and no skills from the degree title', () => {
    const profile = heuristicProfile(ENGLISH_CV, NOW);
    expect(profile.skills).toEqual(expect.arrayContaining(['Zendesk', 'Salesforce', 'MS Office', 'حل المشكلات']));
    expect(profile.skills).not.toContain('الأعمال الإدارية'); // "Business Administration" is the diploma, not a skill
    expect(profile.skills).not.toContain('Problem solving');
    expect(profile.languages).toEqual(['العربية', 'الإنجليزية']);
    expect(profile.education).toEqual(['Diploma in Business Administration · Riyadh College of Technology · ٢٠٢٠']);
  });

  it('reads an unstructured healthcare CV with Hijri dates and no headings', () => {
    const profile = heuristicProfile(NURSE_CV, NOW);
    expect(profile.experience).toEqual([
      'ممرضة · مستشفى الملك فهد التخصصي بالدمام · ٢٠١٩ – ٢٠٢٤ (٥ سنوات) — رعاية المرضى وتسجيل السجلات الطبية',
      'متدربة تمريض · مستشفى الحرس الوطني · ٢٠١٨ – ٢٠١٩ (سنة)',
    ]);
    expect(profile.summary.startsWith('ممرضة بخبرة ٦ سنوات، آخرها لدى مستشفى الملك فهد التخصصي بالدمام.')).toBe(true);
    expect(profile.skills).toEqual(expect.arrayContaining(['رعاية المرضى', 'الإسعافات الأولية والإنعاش', 'مكافحة العدوى']));
    expect(profile.suggestedRoles[0]).toBe('ممرضة');
  });

  it('does not double-count overlapping roles', () => {
    const roles = parseExperience(['مطور - شركة أ - 01/2020 - 12/2021', 'مستشار - شركة ب - 06/2021 - 12/2022']);
    expect(totalYears(roles, NOW)).toBe(3);
    expect(formatExperience(roles[0]!, NOW)).toBe('مطور · شركة أ · يناير ٢٠٢٠ – ديسمبر ٢٠٢١ (سنتان)');
  });

  it('recognises section headings in both languages, including inline ones', () => {
    const kinds = splitSections('الخبرات العملية\nx\nEDUCATION\ny\nالمهارات: Excel، SQL\nLanguages:\nArabic').map(section => section.kind);
    expect(kinds).toEqual(['experience', 'education', 'skills', 'languages']);
  });
});

describe('Verifying Claude’s reading against the CV', () => {
  const cv = 'محلل بيانات - شركة المراعي - 2022 - الآن: بناء لوحات Power BI وتنظيف البيانات باستخدام SQL.';
  const ai = {
    summary: 'محلل بيانات يبني لوحات معلومات.',
    experience: [
      { title: 'محلل بيانات', organization: 'شركة المراعي', location: '', start: '2022', end: 'present', highlights: ['بنى لوحات Power BI.'], evidence: 'محلل بيانات - شركة المراعي' },
      // Not in the CV: must be dropped.
      { title: 'مدير مشاريع', organization: 'شركة نيوم', location: '', start: '2019', end: '2021', highlights: [], evidence: 'مدير مشاريع في نيوم' },
    ],
    skills: [
      { name: 'Power BI', kind: 'tool' as const, evidence: 'لوحات Power BI' },
      { name: 'SQL', kind: 'technical' as const, evidence: 'باستخدام SQL' },
      { name: 'Tableau', kind: 'tool' as const, evidence: 'Tableau dashboards' },
    ],
    education: [], certifications: [], languages: ['العربية'], suggestedRoles: ['محلل بيانات'], searchKeywords: ['Data Analyst'],
  };

  it('matches quotes despite spelling variants', () => {
    expect(supportedByText('شركه المراعى', 'محلل بيانات شركة المراعي'.replace('ة', 'ه').replace('ي', 'ي'))).toBe(true);
  });

  it('drops roles and skills that the CV does not support, and computes duration itself', () => {
    const profile = verifiedClaudeProfile(ai, cv, NOW);
    expect(profile.experienceDetails.map(role => role.title)).toEqual(['محلل بيانات']);
    expect(profile.experience[0]).toBe('محلل بيانات · شركة المراعي · ٢٠٢٢ – الآن (٤ سنوات) — بنى لوحات Power BI');
    expect(profile.skills).toEqual(['SQL', 'Power BI']);
    expect(profile.engine).toBe('claude');
  });

  it('fills gaps from the offline reader without duplicating skills', () => {
    const merged = mergeProfiles(verifiedClaudeProfile(ai, cv, NOW), heuristicProfile(cv, NOW));
    expect(merged.skills.filter(skill => skill === 'SQL')).toHaveLength(1);
    expect(merged.searchKeywords).toContain('Data Analyst');
  });
});

describe('Jobs from feeds and open-vocabulary matching', () => {
  it('reads RSS job feeds', () => {
    const rss = `<rss><channel><item><title><![CDATA[مدخل بيانات - شركة الأفق]]></title><link>https://jobs.example.sa/123</link><description>وظيفة عن بعد لذوي الإعاقة السمعية في الرياض</description><pubDate>Mon, 16 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>`;
    expect(parseFeed(rss, 'https://jobs.example.sa/feed')).toEqual([expect.objectContaining({ title: 'مدخل بيانات', company: 'شركة الأفق', sourceUrl: 'https://jobs.example.sa/123', mode: 'عن بُعد', location: 'عن بُعد' })]);
  });
  it('reads JSON job feeds', () => {
    const json = JSON.stringify({ jobs: [{ title: 'مصمم', company: 'استوديو', location: 'جدة', mode: 'hybrid', url: 'https://x.sa/j/1', skills: ['Figma'] }] });
    expect(parseFeed(json, 'https://x.sa/feed.json')[0]).toMatchObject({ title: 'مصمم', mode: 'هجين', skills: ['Figma'] });
  });
  it('matches skills outside the taxonomy by shared words', () => {
    expect(skillsMatch('إدارة المشاريع الإنشائية', 'إدارة المشاريع')).toBe(true);
    expect(skillsMatch('Zendesk', 'CRM')).toBe(true);
    expect(skillsMatch('اكسل', 'Microsoft Excel')).toBe(true);
    expect(skillsMatch('Figma', 'SQL')).toBe(false);
  });
});
