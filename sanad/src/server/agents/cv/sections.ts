import { normalizeArabic } from '../../text/arabic';

/** Splits a CV into its standard sections (Arabic and English headings), the way an ATS parses it. */
export type SectionKind = 'summary' | 'experience' | 'volunteer' | 'education' | 'skills' | 'certifications' | 'languages' | 'projects' | 'awards' | 'contact' | 'other' | 'header';
export interface Section { kind: SectionKind; heading: string; lines: string[] }

// Patterns are written in normalised form (ة→ه، أ/إ→ا، ى→ي) because they are tested on normalizeArabic(line).
const HEADINGS: [SectionKind, RegExp][] = [
  ['experience', /^(ال)?(خبرات|خبره)( ال(عمليه|مهنيه|وظيفيه|سابقه|العمليه))?$|^(السجل المهني|المسيره المهنيه|التاريخ الوظيفي|الوظائف السابقه|الخبرات والوظائف|التدريب التعاوني|التدريب الميداني|الخبرات والتدريب)$|^((work|professional|relevant|practical|internship|training) )?experiences?$|^(employment|work|career|job) history$|^(internships?|co-?op training|cooperative training|practical training)$/],
  ['volunteer', /^(ال)?(اعمال )?(تطوع|تطوعيه|العمل التطوعي|الاعمال التطوعيه|الانشطه|الانشطه والتطوع|التطوع والانشطه)$|^(volunteer(ing)?( work| experience| activities)?|(extracurricular|student|leadership) activities|activities|volunteering (and|&) activities)$/],
  ['education', /^(ال)?(تعليم|مؤهلات|مؤهل)( ال(علميه|علمي|اكاديميه|دراسيه))?$|^(الدراسه|التحصيل العلمي|المؤهلات العلميه|المؤهل العلمي)$|^(education( (and|&) training)?|academic background|academic qualifications|qualifications|educational background)$/],
  ['skills', /^(ال)?مهارات( ال(تقنيه|فنيه|شخصيه|مهنيه|اساسيه|حاسوبيه|اداريه))?$|^(القدرات|الكفاءات|الادوات والبرامج|البرامج|المهارات والادوات)$|^((technical|core|key|soft|hard|professional|computer|it) )?skills( (and|&) (tools|abilities|competencies|technologies))?( summary)?$|^(core )?competencies$|^(tools|technologies|tech stack|expertise|tools (and|&) technologies)$/],
  ['certifications', /^(ال)?(شهادات|رخص|دورات|الدورات التدريبيه|البرامج التدريبيه|التدريب|الشهادات والدورات|الدورات والشهادات|الشهادات والدورات التدريبيه)( المهنيه| الاحترافيه)?$|^(certifications?|certificates?|licenses?( (and|&) certifications)?|courses|training|professional development|(certifications?|certificates?) (and|&) (courses|training)|(courses|training) (and|&) (certifications?|certificates?)|licenses (and|&) certificates)$/],
  ['languages', /^(ال)?لغات$|^languages?$/],
  ['summary', /^(ال)?(ملخص|نبذه|الهدف|هدف)( ال(مهني|وظيفي|شخصي))?( عني| مختصره)?$|^(عني|نبذه عني|التعريف)$|^((professional |career |executive )?summary|profile|professional profile|objective|career objective|about( me)?)$/],
  ['projects', /^(ال)?مشاريع( ال(عمليه|اكاديميه|شخصيه))?$|^(مشروع التخرج|المشاريع والابحاث)$|^((academic|personal|key|selected|graduation|university) )?projects?$/],
  ['awards', /^(ال)?(جوائز|انجازات|الجوائز والانجازات|التكريم)$|^(awards?|achievements|honou?rs( (and|&) awards)?|awards (and|&) (achievements|honou?rs))$/],
  ['contact', /^(ال)?(معلومات|بيانات)( ال)?(شخصيه|التواصل|الاتصال)$|^(contact( info| information| details)?|personal (info|information|details))$/],
  ['other', /^(ال)?(هوايات|اهتمامات|المعرفون|مراجع)$|^(hobbies|interests|references|publications|memberships)$/],
];

function headingKind(line: string): SectionKind | null {
  // «Skills & Tools»: normalizeArabic() drops «&», so spell it out first.
  const key = normalizeArabic(line.replace(/&/g, ' and ').replace(/^\d+[.)]\s*/, '')).replace(/\s*[:：]\s*$/, '').replace(/\s+/g, ' ').trim();
  if (!key || key.length > 50) return null;
  for (const [kind, pattern] of HEADINGS) if (pattern.test(key)) return kind;
  return null;
}

/** Lines of the CV with whitespace collapsed and typographic apostrophes made plain. */
export function cvLines(text: string): string[] {
  return text.split(/\r?\n/).map(line => line.replace(/[ʼ’‘]/g, "'").replace(/\|{3,}/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** An unknown heading such as «REFERENCES:» — all capitals and a colon. It closes the previous section. */
const unknownHeading = (line: string) => /^[A-Z][A-Z &/-]{3,40}\s*:$/.test(line);

export function splitSections(text: string): Section[] {
  const sections: Section[] = [{ kind: 'header', heading: '', lines: [] }];
  // After a one-line heading («Languages: Arabic»), the next lines go back to the section we were in.
  let resume: Section | null = null;
  for (const line of cvLines(text)) {
    const kind = headingKind(line);
    if (kind) { sections.push({ kind, heading: line, lines: [] }); resume = null; continue; }
    // Heading with content on the same line: «المهارات: Excel، SQL» / «Technical Skills: Python, SQL».
    const inline = /^([^:：]{2,45})[:：]\s*(.+)$/.exec(line);
    const inlineKind = inline ? headingKind(inline[1]!) : null;
    if (inline && inlineKind) {
      const previous = sections[sections.length - 1]!;
      sections.push({ kind: inlineKind, heading: inline[1]!.trim(), lines: [inline[2]!.trim()] });
      resume = previous.kind !== inlineKind ? previous : resume;
      continue;
    }
    if (sections.length > 1 && unknownHeading(line)) { sections.push({ kind: 'other', heading: line, lines: [] }); resume = null; continue; }
    if (resume) { sections.push({ kind: resume.kind, heading: resume.heading, lines: [] }); resume = null; }
    sections[sections.length - 1]!.lines.push(line);
  }
  return sections.filter(section => section.lines.length || section.kind !== 'header');
}

export function linesOf(sections: Section[], ...kinds: SectionKind[]): string[] {
  return sections.filter(section => kinds.includes(section.kind)).flatMap(section => section.lines);
}
