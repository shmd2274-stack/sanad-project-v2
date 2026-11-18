// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { heuristicProfile } from '@/server/agents/cv/heuristic';
import { matchJob } from '@/server/agents/jobs/matching';
import { personalQueries } from '@/server/agents/jobs/jobs-agent';

/**
 * The same reader on very different CVs (made-up people): IT, business / HR, engineering,
 * a new graduate, and a long career written date-first. Nothing here is specific to one CV.
 */
const NOW = new Date('2026-11-18T09:00:00Z');

// IT, English, two-column PDF layout: the date and city come out between the achievements.
const IT_CV = `Lama Saleh Alqahtani
lama.saleh@example.com | +966 55 000 1122 | Jeddah, Saudi Arabia | linkedin.com/in/lama-example
SUMMARY :
Software engineer with experience building web and mobile applications for e-commerce and logistics companies in Saudi Arabia.
PROFESSIONAL EXPERIENCE :
Software Engineer - Salla, Jeddah
•Built 12 REST APIs with Node.js and PostgreSQL serving 40,000 daily orders.
•Reduced page load time by 35% by moving the storefront to React and Next.js.
Mar 2023 – Present
Saudi Arabia, Jeddah
•Mentored 3 junior developers and reviewed code on GitHub.
Junior Web Developer – Tamara
•Developed checkout screens in React and TypeScript.
Jan 2022 – Feb 2023
Riyadh, Saudi Arabia
EDUCATION :
Bachelor of Science in Computer Science, King Abdulaziz University
Sep 2017 – Jun 2021
PROJECTS :
Delivery Tracker App, Flutter, Firebase, Google Maps API
Built a mobile app that shows live delivery status to customers.
VOLUNTEER EXPERIENCE :
Workshop Mentor, Google Developer Group Jeddah
Taught web basics to 50 high-school students.
Feb 2022 – Dec 2022
SKILLS :
Technical Skills: JavaScript, TypeScript, React, Node.js, PostgreSQL, Docker, Git
Soft Skills: Teamwork | Problem Solving | Time Management
LANGUAGES :
Arabic (Native), English (Fluent)`;

// Business administration / HR, Arabic, one-line roles.
const HR_CV = `عبدالله فهد المطيري
البريد: abdullah@example.com | الجوال: 0501234567 | الرياض
الملخص المهني
أخصائي موارد بشرية وإدارة أعمال بخبرة في التوظيف وإدارة شؤون الموظفين وإعداد التقارير الإدارية للإدارة العليا.
الخبرات العملية
أخصائي موارد بشرية - شركة المراعي - الرياض - 2021 - الآن
• أدرت إجراءات توظيف 120 موظفًا سنويًا باستخدام نظام SAP.
• أعددت تقارير شهرية للإدارة العليا عن الحضور والرواتب.
منسق إداري - بنك الرياض - 2018 - 2021
• نظمت المراسلات الإدارية وأرشفة العقود.
التعليم
بكالوريوس إدارة أعمال - جامعة الملك سعود - 2018 - المعدل 4.2 من 5
الدورات والشهادات
• شهادة SHRM-CP - جمعية إدارة الموارد البشرية 2022
• إدارة المشاريع الاحترافية PMP - معهد إدارة المشاريع
المهارات
الموارد البشرية، التوظيف، SAP، Excel، إعداد التقارير، التفاوض، القيادة
اللغات
العربية: اللغة الأم، الإنجليزية: جيد جدًا`;

// Engineering, English, title | company | city | dates on one line.
const ENGINEER_CV = `Omar Khalid Alzahrani
Mechanical Engineer
Jubail, Saudi Arabia | omar.eng@example.com | +966 50 111 2233
Professional Summary
Mechanical engineer with experience in plant maintenance, reliability and HVAC design for petrochemical plants.
Work Experience
Senior Mechanical Engineer | SABIC | Jubail | Jan 2022 – Present
- Led preventive maintenance for 40 rotating equipment units, cutting downtime by 18%.
- Designed HVAC upgrades in AutoCAD and Revit.
Mechanical Engineer | Saudi Aramco | Dhahran | Jul 2019 – Dec 2021
- Performed root cause analysis on pump failures.
Engineering Intern | Marafiq | Jubail | Jun 2018 – Aug 2018
- Assisted the reliability team with vibration analysis.
Education
B.Sc. Mechanical Engineering – King Fahd University of Petroleum and Minerals – 2019
Certifications
PMP – Project Management Institute – 2023
Skills
AutoCAD, Revit, SolidWorks, HVAC, Preventive Maintenance, Root Cause Analysis, MS Project
Languages
Arabic, English`;

// New graduate, Arabic: co-op training under «التدريب», a graduation project, volunteering — no job yet.
const GRADUATE_CV = `ريم سعد الدوسري
الدمام | reem@example.com | 0555555555
الهدف الوظيفي
خريجة محاسبة أبحث عن فرصة في المحاسبة المالية أو المراجعة لدى جهة تهتم بالتطوير المهني.
التعليم
بكالوريوس المحاسبة، جامعة الإمام عبدالرحمن بن فيصل، 2025، المعدل 4.6 من 5
التدريب
متدربة محاسبة - شركة أرامكو السعودية - يونيو 2024 - أغسطس 2024
• أدخلت 300 قيد يومية في نظام SAP وطابقت كشوفات البنوك.
المشاريع
مشروع التخرج: تحليل القوائم المالية لشركات السوق السعودي، Excel، Power BI
الأعمال التطوعية
متطوعة - جمعية إنسان - 2022 - 2023
• نظمت حملات توزيع للأسر المحتاجة.
المهارات
المحاسبة المالية، Excel، SAP، الزكاة والضريبة، العمل الجماعي`;

// Several jobs, date-first layout, lower-case company name.
const CAREER_CV = `NOURA ABDULLAH
Customer Experience Manager
Riyadh · noura@example.com · +966 54 999 8877
EXPERIENCE
2022 – Present
Customer Experience Manager
stc, Riyadh
• Led a team of 25 chat agents and raised CSAT from 78% to 91%.
2019 – 2022
Team Leader, Customer Care
Almarai, Riyadh
• Built Zendesk workflows that cut response time by 40%.
2017 – 2019
Customer Service Representative
Jarir Bookstore, Riyadh
• Handled 80+ online inquiries per day.
2016 – 2017
Sales Associate
eXtra, Riyadh
EDUCATION
Bachelor of Business Administration, Prince Sultan University, 2016
SKILLS
Zendesk, Salesforce, CRM, Customer Experience, Team Leadership, Written Communication`;

const kinds = (profile: ReturnType<typeof heuristicProfile>) => profile.experienceDetails.map(role => role.kind);

describe('ATS reading across different CVs', () => {
  it('IT: two-column layout, roles vs volunteering vs projects', () => {
    const profile = heuristicProfile(IT_CV, NOW, { fileName: 'cv.pdf' });
    expect(profile.experience).toEqual([
      'Software Engineer · Salla · ٣ سنوات و٩ أشهر',
      'Junior Web Developer · Tamara · سنة وشهران',
      'Workshop Mentor · Google Developer Group Jeddah · ١١ شهرًا · تطوعي',
    ]);
    expect(kinds(profile)).toEqual(['job', 'job', 'volunteer']);
    expect(profile.experienceDetails[0]).toMatchObject({ location: 'Jeddah', current: true, period: 'مارس ٢٠٢٣ – الآن' });
    expect(profile.experienceDetails[1]).toMatchObject({ location: 'Riyadh, Saudi Arabia' });
    // Volunteering is not counted as work experience, and projects are not roles.
    expect(profile.yearsExperience).toBe(4.9);
    expect(profile.jobTitles).toEqual(['Software Engineer', 'Junior Web Developer']);
    expect(profile.projects).toEqual([expect.objectContaining({ name: 'Delivery Tracker App', tools: ['Flutter', 'Firebase', 'Google Maps API'] })]);
    expect(profile.experience.join(' ')).not.toContain('Delivery Tracker');
    expect(profile.skills).toEqual(expect.arrayContaining(['JavaScript', 'React', 'Node.js', 'Docker', 'Git', 'Flutter', 'Firebase', 'العمل الجماعي']));
    expect(profile.education).toEqual(['Bachelor of Science in Computer Science · King Abdulaziz University · ٢٠٢١']);
    expect(profile.languages).toEqual(['العربية', 'الإنجليزية']);
    expect(profile.suggestedRoles).toEqual(expect.arrayContaining(['Software Engineer', 'مطور برمجيات']));
    expect(profile.ats).toMatchObject({ contact: { email: true, phone: true, city: 'Jeddah', linkedin: true } });
    expect(profile.ats!.score).toBeGreaterThanOrEqual(85);
  });

  it('Business / HR: Arabic one-line roles, certificates, GPA, HR roles (not accounting)', () => {
    const profile = heuristicProfile(HR_CV, NOW);
    expect(profile.experience).toEqual(['أخصائي موارد بشرية · شركة المراعي · ٥ سنوات', 'منسق إداري · بنك الرياض · ٣ سنوات']);
    expect(profile.yearsExperience).toBe(8);
    expect(profile.careerLevel).toBe('خبير');
    expect(profile.education).toEqual(['بكالوريوس إدارة أعمال · جامعة الملك سعود · ٢٠١٨ · المعدل 4.2/5']);
    expect(profile.certifications).toEqual(['شهادة SHRM-CP · جمعية إدارة الموارد البشرية · ٢٠٢٢', 'إدارة المشاريع الاحترافية PMP · معهد إدارة المشاريع']);
    expect(profile.skills).toEqual(expect.arrayContaining(['الموارد البشرية', 'SAP', 'Excel', 'إعداد التقارير', 'التفاوض', 'القيادة']));
    expect(profile.suggestedRoles[0]).toBe('أخصائي موارد بشرية');
    expect(profile.suggestedRoles).not.toContain('محاسب');
    expect(profile.ats!.contact.city).toBe('الرياض');
  });

  it('Engineering: title | company | city | dates, internship kept apart, tool names kept', () => {
    const profile = heuristicProfile(ENGINEER_CV, NOW);
    expect(profile.experience).toEqual([
      'Senior Mechanical Engineer · SABIC · ٤ سنوات و١١ شهرًا',
      'Mechanical Engineer · Saudi Aramco · سنتان و٦ أشهر',
      'Engineering Intern · Marafiq · ٣ أشهر',
    ]);
    expect(kinds(profile)).toEqual(['job', 'job', 'internship']);
    expect(profile.experienceDetails.map(role => role.location)).toEqual(['Jubail', 'Dhahran', 'Jubail']);
    expect(profile.yearsExperience).toBe(7.7);
    expect(profile.skills).toEqual(expect.arrayContaining(['AutoCAD', 'Revit', 'SolidWorks', 'HVAC', 'MS Project']));
    expect(profile.education).toEqual(['B.Sc. Mechanical Engineering · King Fahd University of Petroleum and Minerals · ٢٠١٩']);
    expect(profile.certifications).toEqual(['PMP · Project Management Institute · ٢٠٢٣']);
    expect(profile.suggestedRoles[0]).toBe('Senior Mechanical Engineer');
  });

  it('New graduate: internship under «التدريب», graduation project and volunteering are not jobs', () => {
    const profile = heuristicProfile(GRADUATE_CV, NOW);
    expect(profile.experience).toEqual(['متدربة محاسبة · شركة أرامكو السعودية · ٣ أشهر', 'متطوعة · جمعية إنسان · سنة · تطوعي']);
    expect(kinds(profile)).toEqual(['internship', 'volunteer']);
    expect(profile.jobTitles).toEqual(['متدربة محاسبة']);
    expect(profile.careerLevel).toBe('حديث تخرج (تدريب تعاوني)');
    expect(profile.certifications).toEqual([]);
    expect(profile.projects).toEqual([expect.objectContaining({ name: 'تحليل القوائم المالية لشركات السوق السعودي', tools: ['Excel', 'Power BI'] })]);
    expect(profile.education).toEqual(['بكالوريوس المحاسبة · جامعة الإمام عبدالرحمن بن فيصل · ٢٠٢٥ · المعدل 4.6/5']);
    expect(profile.suggestedRoles).toEqual(expect.arrayContaining(['محاسبة', 'محاسب']));
    // The jobs agent searches graduate programmes and entry-level roles for this level.
    expect(personalQueries({ suggestedRoles: profile.suggestedRoles, searchKeywords: profile.searchKeywords, careerLevel: profile.careerLevel, skills: profile.skills }).join(' | ')).toContain('برنامج تطوير الخريجين');
  });

  it('Long career written date-first, with a lower-case company name', () => {
    const profile = heuristicProfile(CAREER_CV, NOW);
    expect(profile.experience).toEqual([
      'Customer Experience Manager · stc · ٤ سنوات',
      'Team Leader، Customer Care · Almarai · ٣ سنوات',
      'Customer Service Representative · Jarir Bookstore · سنتان',
      'Sales Associate · eXtra · سنة',
    ]);
    expect(profile.yearsExperience).toBe(10);
    expect(profile.careerLevel).toBe('خبير أول');
    expect(profile.skills).toEqual(expect.arrayContaining(['Zendesk', 'Salesforce', 'CRM', 'التواصل الكتابي', 'القيادة']));
  });
});

describe('Job matching compares real requirements, and a similar title alone does not lift the score', () => {
  const frontend = { title: 'مطور واجهات أمامية', english: 'Frontend Developer', description: 'تطوير واجهات بـ React وTypeScript وJavaScript.', skills: ['React', 'TypeScript', 'JavaScript'], location: 'جدة', mode: 'هجين' };
  const mechanical = { title: 'مهندس ميكانيكي', english: 'Mechanical Engineer', description: 'صيانة المعدات وتصميم أنظمة التكييف. خبرة 5 سنوات وبكالوريوس هندسة.', skills: ['AutoCAD', 'HVAC', 'الصيانة'], location: 'الجبيل', mode: 'حضوري' };
  const cobol = { title: 'Software Engineer', english: 'Software Engineer', description: 'Maintain banking systems in COBOL on IBM mainframes.', skills: ['COBOL', 'Mainframe'], location: 'الرياض', mode: 'حضوري' };

  it('scores each CV against each job from the requirements', () => {
    const it = heuristicProfile(IT_CV, NOW); const hr = heuristicProfile(HR_CV, NOW); const engineer = heuristicProfile(ENGINEER_CV, NOW);
    const itFrontend = matchJob(it, frontend, IT_CV);
    expect(itFrontend.score).toBeGreaterThanOrEqual(85);
    expect(itFrontend.missingSkills).toEqual([]);
    expect(matchJob(hr, frontend, HR_CV).score).toBeLessThan(25);
    const engineerMatch = matchJob(engineer, mechanical, ENGINEER_CV);
    expect(engineerMatch.score).toBeGreaterThanOrEqual(80);
    expect(engineerMatch.reason).toContain('AutoCAD');
    expect(matchJob(it, mechanical, IT_CV).score).toBeLessThan(25);
  });

  it('names the gaps, and keeps a same-title job with other requirements low', () => {
    const it = heuristicProfile(IT_CV, NOW);
    const result = matchJob(it, cobol, IT_CV);
    expect(it.jobTitles).toContain('Software Engineer');
    expect(result.score).toBeLessThan(30);
    expect(result.missingSkills).toEqual(['COBOL', 'Mainframe']);
    expect(result.reason).toContain('COBOL');
  });
});
