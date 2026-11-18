import { normalizeArabic, uniqueStrings } from '../../text/arabic';
import { canonicalSkill, findSkills, skillGroup } from '../skills-taxonomy';
import { linesOf, type Section } from './sections';

/**
 * Skills for any CV, in any field: everything the candidate lists in a skills section (open vocabulary),
 * plus known skills mentioned anywhere (taxonomy), normalised to one name each. Languages are kept separate.
 */
const LEVEL = /\s*[([]?\s*(ممتاز|جيد جدا|جيد جدًا|جيد|متوسط|مبتدئ|متقدم|محترف|خبير|اللغة الأم|اللغه الام|لغة أم|advanced|intermediate|beginner|expert|fluent|native|basic|proficient|good|very good|excellent|\d{1,3}\s*%|[★☆●○]+)\s*[)\]]?\s*$/i;
const NOT_A_SKILL = /(سنوات|سنة|خبرة في|years?|experience|@|https?:|www\.|\d{3,})/i;

function cleanItem(item: string): string {
  let value = item.replace(/^[•·▪●◦○■□➢➤✓✔*\-–\d.)\s]+/, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i += 1) value = value.replace(LEVEL, '').trim();
  return value.replace(/[.:؛;]+$/, '').trim();
}

export function sectionSkills(sections: Section[]): string[] {
  const items = linesOf(sections, 'skills')
    // «المهارات التقنية: Excel، SQL» → drop the category label.
    .map(line => line.replace(/^[^:：]{2,30}[:：]\s*/, ''))
    .flatMap(line => line.split(/[,،;؛|•·]|\s{2,}|\s[-–]\s|\s\/\s/))
    .map(cleanItem)
    .filter(item => item.length >= 2 && item.length <= 48 && item.split(' ').length <= 6 && !NOT_A_SKILL.test(item));
  return items.map(displaySkill);
}

const ARABIC = /[ء-ي]/;
/**
 * The candidate's own wording for specific tools («Zendesk», «MS Office»), the shared Arabic name
 * for concepts and spelling variants («Problem solving» / «حل المشاكل» → «حل المشكلات»، «اكسل» → «Excel»).
 */
export function displaySkill(item: string): string {
  const canonical = canonicalSkill(item);
  if (canonical === item.trim()) return canonical;
  return ARABIC.test(item) || ARABIC.test(canonical) ? canonical : item.trim();
}

export function extractSkills(sections: Section[], text: string): string[] {
  const listed = sectionSkills(sections);
  // Mine skills from experience, summary and projects — not from degree names or contact details.
  const minedText = sections.filter(section => !['education', 'contact', 'languages'].includes(section.kind)).flatMap(section => section.lines).join('\n') || text;
  // Anything a listed item already covers («Typing 60 WPM» covers «الطباعة السريعة»).
  const listedCanonical = new Set([...listed.map(skill => canonicalSkill(skill)), ...findSkills(listed.join('\n'))].map(normalizeArabic));
  const mentioned = findSkills(minedText).filter(skill => !listedCanonical.has(normalizeArabic(skill)));
  return uniqueStrings([...listed, ...mentioned].filter(skill => skillGroup(skill) !== 'language'), 25);
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
