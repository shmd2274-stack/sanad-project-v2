import { normalizeArabic, uniqueStrings } from '../../text/arabic';
import { canonicalSkill, findSkills, skillGroup } from '../skills-taxonomy';
import { linesOf, type Section } from './sections';

/**
 * Skills for any CV, in any field, the way an ATS indexes them: everything listed in the skills
 * section (open vocabulary, category labels removed), tools named in projects, skills proven by
 * certificates, and known skills mentioned in the achievements. One name per skill; languages separate.
 */
const LEVEL = /\s*[([]?\s*(ممتاز|جيد جدا|جيد جدًا|جيد|متوسط|مبتدئ|متقدم|محترف|خبير|اللغة الأم|اللغه الام|لغة أم|advanced|intermediate|beginner|expert|fluent|native|basic|proficient|good|very good|excellent|\d{1,3}\s*%|[★☆●○]+)\s*[)\]]?\s*$/i;
const NOT_A_SKILL = /(سنوات|سنة|خبرة في|years?|experience|@|https?:|www\.|\d{3,})/i;
const ARABIC = /[ء-ي]/;
// «Data & Analysis:», «Cybersecurity:», «المهارات التقنية:» — category labels inside a skills list.
const LABEL = /(^|[|•;؛]|\s)([A-Za-z][A-Za-z&/ ]{1,28}|[ء-ي][ء-ي ]{1,28})\s*[:：]\s*/g;
const SEPARATORS = /[,،;؛|•·]|\s{2,}|\s[-–—]\s|\s\/\s/;

export function cleanItem(item: string): string {
  let value = item.replace(/^[•·▪●◦○■□➢➤✓✔*\-–—\d.)\s]+/, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i += 1) value = value.replace(LEVEL, '').trim();
  value = value.replace(/[.:؛;]+$/, '').trim();
  if (value.startsWith('(') && !value.includes(')')) value = value.slice(1).trim();
  if (value.endsWith(')') && !value.includes('(')) value = value.slice(0, -1).trim();
  return value;
}

/** Splits a comma list, ignoring commas inside brackets: «Elm AI Models (TTS, ASR), Figma». */
export function splitList(text: string, pattern = SEPARATORS): string[] {
  const out: string[] = [];
  let depth = 0; let piece = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (char === '(' || char === '[') depth += 1;
    if ((char === ')' || char === ']') && depth > 0) depth -= 1;
    if (depth === 0 && pattern.test(char)) { out.push(piece); piece = ''; continue; }
    piece += char;
  }
  out.push(piece);
  return out.flatMap(part => part.split(/\s{2,}|\s[-–—]\s|\s\/\s/)).map(part => part.trim()).filter(Boolean);
}

/** «UI Design (Figma)» → «UI Design» + «Figma»; «Web Development (Front End)» stays one skill. */
function expandBrackets(item: string): string[] {
  const match = /^(.+?)\s*\((.+)\)$/.exec(item);
  if (!match) return [item];
  const inner = match[2]!.split(/[,،]/).map(part => part.trim()).filter(Boolean);
  const known = inner.filter(part => findSkills(part).length || canonicalSkill(part) !== part);
  if (!known.length) return [item];
  const outer = canonicalSkill(match[1]!.trim());
  return [match[1]!.trim(), ...known.filter(part => canonicalSkill(part) !== outer)];
}

/** Long runs without separators («Organizational Skills Communication Skills Critical Thinking») → known skills. */
function segment(item: string): string[] {
  if (item.split(/\s+/).length <= 5) return [item];
  const found = findSkills(item);
  const named = [...item.matchAll(/([A-Z][A-Za-z-]+(?:\s[A-Z][A-Za-z-]+)?\sSkills)/g)].map(match => match[1]!).filter(skill => !findSkills(skill).length);
  return [...found, ...named];
}

export function sectionSkills(sections: Section[]): string[] {
  const text = linesOf(sections, 'skills').join(' | ').replace(LABEL, (_all, before: string) => `${before === ' ' ? '' : before} | `);
  const items = splitList(text, /[,،;؛|•·]/)
    // «Robotics: (Arduino , Nao Robot)» → the bracketed list itself.
    .flatMap(item => /^\(.*\)$/.test(item.trim()) ? item.trim().slice(1, -1).split(/[,،]/) : [item])
    .flatMap(segment)
    .map(cleanItem)
    .flatMap(expandBrackets)
    .map(cleanItem)
    .filter(item => item.length >= 1 && item.length <= 48 && item.split(' ').length <= 6 && !NOT_A_SKILL.test(item) && /[A-Za-zء-ي]/.test(item));
  return uniqueStrings(items.map(displaySkill));
}

/**
 * The candidate's own wording for specific tools («Zendesk», «MS Office»), the shared Arabic name
 * for concepts and spelling variants («Problem solving» / «حل المشاكل» → «حل المشكلات»، «Data Analysis» → «تحليل البيانات»).
 */
// Products and brands keep their own name even when they belong to a broader skill (AutoCAD → 3D design).
const BRANDS = new Set(['autocad', 'revit', 'blender', '3ds max', 'solidworks', 'catia', 'canva', 'premiere', 'after effects', 'final cut', 'splunk', 'qradar', 'nessus', 'burp suite', 'docker', 'kubernetes', 'jenkins', 'terraform', 'ansible', 'jira', 'trello', 'sap', 'oracle', 'salesforce', 'zendesk', 'hubspot', 'freshdesk', 'odoo', 'quickbooks', 'sage', 'primavera', 'ms project', 'etap', 'arcgis', 'qgis', 'photoshop', 'illustrator', 'indesign', 'lightroom', 'sketch', 'invision', 'zeplin', 'looker', 'qlik', 'spss', 'sas', 'stata', 'hadoop', 'spark', 'pyspark', 'kafka', 'airflow', 'opencv', 'yolo', 'keras', 'pandas', 'numpy', 'dart', 'swiftui', 'firestore', 'xgboost', 'raspberry pi', 'chatgpt', 'gpt-4', 'ccna', 'pmp', 'capm', 'cissp', 'itil', 'ifrs', 'lean', 'six sigma']);
const isAcronym = (value: string) => /^[A-Z]{2,6}$/.test(value);

export function displaySkill(item: string): string {
  const value = item.trim();
  const canonical = canonicalSkill(value);
  if (canonical !== value && ARABIC.test(canonical) && !ARABIC.test(value)) {
    // «HVAC», «SAP», «AutoCAD»: the name an ATS and an employer search for.
    if (BRANDS.has(normalizeArabic(value)) || (isAcronym(value) && !canonical.includes(value))) return value;
    return canonical;
  }
  if (canonical !== value) return ARABIC.test(value) || ARABIC.test(canonical) ? canonical : value;
  const found = findSkills(value);
  // «Web Development (Front End)» → «تطوير الويب»: one known concept, few extra words.
  if (found.length === 1 && ARABIC.test(found[0]!) && value.split(/\s+/).length <= 4 && !found.includes(value)) return found[0]!;
  return value;
}

// Text that mentions a skill word without being the candidate's skill.
const NOISE = [
  /\bleadership (meetings?|teams?|departments?|members?)\b/gi,
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,
  /https?:\/\/\S+|www\.\S+|linkedin\.com\/\S+/gi,
  /\+?\d[\d\s-]{7,}\d/g,
];
export const withoutNoise = (text: string) => NOISE.reduce((value, pattern) => value.replace(pattern, ' '), text);

const isSoft = (skill: string) => skillGroup(skill) === 'soft';

export interface SkillSources {
  /** Tools named in projects (already display names). */
  projectTools?: string[] | undefined;
  /** Certificate names: «Azure AI Fundamentals» proves cloud and AI. */
  certificationText?: string | undefined;
  /** Achievements, summary and project descriptions (no organisation names or contact details). */
  minedText?: string | undefined;
}

export function extractSkills(sections: Section[], text: string, sources: SkillSources = {}): string[] {
  const listed = sectionSkills(sections);
  const projectTools = sources.projectTools ?? [];
  const certified = findSkills(sources.certificationText ?? '');
  const minedText = sources.minedText ?? sections.filter(section => !['education', 'contact', 'languages', 'header', 'awards'].includes(section.kind)).flatMap(section => section.lines).join('\n');
  const mined = findSkills(withoutNoise(minedText || text));

  // Anything a listed item already covers («Typing 60 WPM» covers «الطباعة السريعة»).
  const seen = new Set<string>();
  const covered = new Set(findSkills(listed.join('\n')).map(normalizeArabic));
  const ordered: string[] = [];
  // One entry per shown name: Zendesk and Salesforce are both CRM tools, and both are kept.
  const add = (skill: string) => {
    const id = normalizeArabic(skill);
    if (!skill || seen.has(id) || skillGroup(skill) === 'language') return;
    seen.add(id); ordered.push(skill);
  };
  listed.forEach(add);
  for (const skill of [...projectTools, ...certified, ...mined]) if (!covered.has(normalizeArabic(canonicalSkill(skill)))) add(skill);
  // Role skills first, soft skills after — both kept.
  const hard = ordered.filter(skill => !isSoft(skill)).slice(0, 22);
  const soft = ordered.filter(isSoft).slice(0, 8);
  return [...hard, ...soft];
}

// [pattern anywhere in the CV, looser pattern inside a languages section, display name]
const LANGUAGES: [RegExp, RegExp, string][] = [
  [/(لغه الاشاره|sign language)/, /(اشاره|sign|ssl|asl)/, 'لغة الإشارة السعودية'],
  [/(اللغه العربيه|\barabic\b)/, /(عربي|arabic)/, 'العربية'],
  [/(اللغه الانجليزيه|الانجليزيه|\benglish\b|ielts|toefl)/, /(انجليزي|انكليزي|english)/, 'الإنجليزية'],
  [/(اللغه الفرنسيه|\bfrench\b)/, /(فرنسي|french)/, 'الفرنسية'],
  [/(اللغه الارديه|\burdu\b)/, /(اردي|اوردو|urdu)/, 'الأردية'],
  [/(اللغه الهنديه|\bhindi\b)/, /(هندي|hindi)/, 'الهندية'],
  [/(اللغه الاسبانيه|\bspanish\b)/, /(اسباني|spanish)/, 'الإسبانية'],
  [/(اللغه الالمانيه|\bgerman\b)/, /(الماني|german)/, 'الألمانية'],
  [/(اللغه التركيه|\bturkish\b)/, /(تركي|turkish)/, 'التركية'],
  [/(اللغه الصينيه|\bchinese\b|mandarin)/, /(صيني|chinese|mandarin)/, 'الصينية'],
];

export function extractLanguages(sections: Section[], text: string): string[] {
  const languageText = normalizeArabic(linesOf(sections, 'languages').join(' '));
  const whole = normalizeArabic(text);
  return uniqueStrings(LANGUAGES.filter(([anywhere, inSection]) => inSection.test(languageText) || anywhere.test(whole)).map(([, , name]) => name));
}
