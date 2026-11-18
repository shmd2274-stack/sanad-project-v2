import { normalizeArabic } from '../../text/arabic';

/** Splits a CV into its sections (Arabic and English headings), the way a recruiter reads it. */
export type SectionKind = 'summary' | 'experience' | 'volunteer' | 'education' | 'skills' | 'certifications' | 'languages' | 'projects' | 'contact' | 'other' | 'header';
export interface Section { kind: SectionKind; heading: string; lines: string[] }

// Patterns are written in normalised form (ة→ه، أ/إ→ا، ى→ي) because they are tested on normalizeArabic(line).
const HEADINGS: [SectionKind, RegExp][] = [
  ['experience', /^(ال)?(خبرات|خبره)( ال(عمليه|مهنيه|وظيفيه|سابقه))?$|^(السجل المهني|المسيره المهنيه|التاريخ الوظيفي|الوظائف السابقه|الخبرات والوظائف|التدريب التعاوني|التدريب الميداني)$|^(work |professional |relevant )?experiences?$|^(employment|work|career|job) history$|^internships?$/],
  ['volunteer', /^(ال)?(اعمال )?(تطوع|تطوعيه|العمل التطوعي|الاعمال التطوعيه)$|^volunteer(ing| work| experience)?$/],
  ['education', /^(ال)?(تعليم|مؤهلات|مؤهل)( ال(علميه|علمي|اكاديميه|دراسيه))?$|^(الدراسه|التحصيل العلمي|المؤهلات العلميه)$|^(education|academic background|academic qualifications|qualifications)$/],
  ['skills', /^(ال)?مهارات( ال(تقنيه|فنيه|شخصيه|مهنيه|اساسيه|حاسوبيه|اداريه))?$|^(القدرات|الكفاءات|الادوات والبرامج|البرامج)$|^((technical|core|key|soft|hard|professional|computer) )?skills( (and|&) (tools|abilities|competencies))?$|^(core )?competencies$|^(tools|technologies|tech stack|expertise)$/],
  ['certifications', /^(ال)?(شهادات|رخص|دورات|الدورات التدريبيه|البرامج التدريبيه|التدريب|الشهادات والدورات|الدورات والشهادات)( المهنيه| الاحترافيه)?$|^(certifications?|certificates?|licenses?( (and|&) certifications)?|courses|training|professional development)$/],
  ['languages', /^(ال)?لغات$|^languages?$/],
  ['summary', /^(ال)?(ملخص|نبذه|الهدف|هدف)( ال(مهني|وظيفي|شخصي))?( عني| مختصره)?$|^(عني|نبذه عني|التعريف)$|^((professional |career )?summary|profile|objective|career objective|about( me)?)$/],
  ['projects', /^(ال)?مشاريع( ال(عمليه|اكاديميه))?$|^projects$/],
  ['contact', /^(ال)?(معلومات|بيانات)( ال)?(شخصيه|التواصل|الاتصال)$|^(contact( info| information)?|personal (info|information|details))$/],
  ['other', /^(ال)?(هوايات|اهتمامات|انجازات|الجوائز|المعرفون|مراجع)$|^(hobbies|interests|awards|achievements|references)$/],
];

function headingKind(line: string): SectionKind | null {
  const key = normalizeArabic(line).replace(/^\d+[.)]\s*/, '').replace(/[:：]$/, '').trim();
  if (!key || key.length > 45) return null;
  for (const [kind, pattern] of HEADINGS) if (pattern.test(key)) return kind;
  return null;
}

export function cvLines(text: string): string[] {
  return text.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export function splitSections(text: string): Section[] {
  const sections: Section[] = [{ kind: 'header', heading: '', lines: [] }];
  for (const line of cvLines(text)) {
    // Heading alone ("الخبرات") or heading with content on the same line ("المهارات: Excel، SQL").
    const inline = /^([^:：]{2,45})[:：]\s*(.+)$/.exec(line);
    const kind = headingKind(line) ?? (inline ? headingKind(inline[1]!) : null);
    if (kind) {
      sections.push({ kind, heading: inline && !headingKind(line) ? inline[1]!.trim() : line, lines: inline && !headingKind(line) ? [inline[2]!.trim()] : [] });
      continue;
    }
    sections[sections.length - 1]!.lines.push(line);
  }
  return sections.filter(section => section.lines.length || section.kind !== 'header');
}

export function linesOf(sections: Section[], ...kinds: SectionKind[]): string[] {
  return sections.filter(section => kinds.includes(section.kind)).flatMap(section => section.lines);
}
