// @vitest-environment node
// TEMPORARY live check of the job sources with made-up CVs. Deleted after use.
import { it } from 'vitest';
import { heuristicProfile } from '@/server/agents/cv/heuristic';
import { configureJobSources, rankForCandidate, searchPlan, searchSources } from '@/server/agents/jobs/sources';

const NL = String.fromCharCode(10);
const CVS: Record<string, string> = {
  ai_data: ['Sara Ali', 'sara@example.com | +966 55 000 0000 | Riyadh, Saudi Arabia', 'SUMMARY :', 'Information Technology graduate with training in artificial intelligence, data analysis and reporting for government entities.', 'PROFESSIONAL EXPERIENCE :', 'Artificial Intelligence Specialist Trainee - Ministry of Culture, Tamheer program', '•Prepared reports and dashboards with Power BI and Python.', 'Feb 2026 – Aug 2026', 'EDUCATION :', "Bachelor's Degree in Information Technology, Princess Nourah University", 'Aug 2021 – Jul 2025', 'SKILLS :', 'Technical Skills: Data Analysis, Machine Learning, Python, SQL, Excel, Power BI, Data Visualization'].join(NL),
  hr_arabic: ['عبدالله المطيري', 'الرياض | abdullah@example.com', 'الخبرات العملية', 'أخصائي موارد بشرية - شركة المراعي - الرياض - 2021 - الآن', '• أدرت إجراءات توظيف 120 موظفًا سنويًا باستخدام نظام SAP.', 'التعليم', 'بكالوريوس إدارة أعمال - جامعة الملك سعود - 2018', 'المهارات', 'الموارد البشرية، التوظيف، SAP، Excel، إعداد التقارير'].join(NL),
  engineer: ['Omar', 'Jubail, Saudi Arabia | omar@example.com', 'Work Experience', 'Mechanical Engineer | SABIC | Jubail | Jan 2019 – Present', '- Led preventive maintenance for 40 rotating equipment units.', 'Education', 'B.Sc. Mechanical Engineering – KFUPM – 2018', 'Skills', 'AutoCAD, HVAC, Preventive Maintenance, Root Cause Analysis'].join(NL),
  graduate_accounting: ['ريم', 'الدمام | reem@example.com', 'التعليم', 'بكالوريوس المحاسبة، جامعة الإمام عبدالرحمن بن فيصل، 2025', 'التدريب التعاوني', 'متدربة محاسبة - شركة أرامكو السعودية - يونيو 2024 - أغسطس 2024', '• أدخلت 300 قيد يومية في نظام SAP.', 'المهارات', 'المحاسبة المالية، Excel، SAP، الزكاة والضريبة'].join(NL),
};

it('searches the live sources per CV', async () => {
  configureJobSources({ fetch: globalThis.fetch, enabled: true });
  for (const [name, text] of Object.entries(CVS)) {
    const profile = heuristicProfile(text, new Date());
    const plan = searchPlan(profile);
    const started = Date.now();
    const { postings, reports, fetched } = await searchSources(plan);
    const ranked = rankForCandidate(postings, profile, text, plan);
    console.log(`LIVE ${name} | queries: ${plan.queries.join(' / ')} | ${Date.now() - started}ms | fetched ${fetched} usable ${postings.length} kept ${ranked.length}`);
    console.log(`LIVE   sources: ${reports.map(report => `${report.source}=${report.status}(${report.count})`).join(', ')}`);
    for (const { item, match } of ranked.slice(0, 6)) console.log(`LIVE   ${match.score}% | ${item.title} | ${item.company} | ${item.location} | ${item.mode} | ${item.sourceName} | ${(item.postedAt ?? '').slice(0, 10)} | ${match.reason}`);
  }
}, 240_000);
