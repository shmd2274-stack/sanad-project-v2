import * as z from 'zod/v4';
import { coachQuestions, generalLiveQuestions, liveQuestionSets } from '@/lib/sanad-data';
import { normalizeArabic } from '../../text/arabic';
import { describeLlmError, llmAvailable, structured } from '../llm';

export interface Simplified { simple: string; glosses: string[]; engine: 'claude' | 'rules' | 'catalog' }

const Schema = z.object({
  simple: z.string().describe('السؤال بعربية مبسطة: جمل قصيرة، كلمات شائعة، فكرة واحدة في كل جملة'),
  glosses: z.array(z.string()).describe('الكلمات الأساسية بترتيب لغة الإشارة السعودية، بلا حروف جر أو أدوات'),
});

const SYSTEM = `أنت "سَند"، مساعد التواصل في مقابلات العمل للصم وضعاف السمع في السعودية.
يصلك كلام مسؤول التوظيف (قد يكون عاميًا أو طويلًا). أعد صياغته لمرشح أصم:
- simple: نفس المعنى تمامًا بعربية فصحى مبسطة، جمل قصيرة (حتى ١٠ كلمات للجملة)، كلمات شائعة، بلا مصطلحات معقدة، وعلى شكل سؤال واضح.
- glosses: الكلمات المفتاحية فقط بترتيب الإشارة (الموضوع ثم التعليق، وأداة السؤال في النهاية)، بصيغة المفرد والمصدر، دون "ال" التعريف إلا في العبارات الثابتة.
لا تضف أسئلة جديدة، ولا تحذف جزءًا مهمًا من السؤال. إن كان الكلام ليس سؤالًا (ترحيب أو تعليق) فبسّطه كما هو.`;

const catalog = new Map<string, string>([...coachQuestions, ...generalLiveQuestions, ...Object.values(liveQuestionSets).flat()].map(item => [normalizeArabic(item.original), item.simple]));

const REWRITES: [RegExp, string][] = [
  [/^(هل )?(يمكنك|ممكن|تستطيع|بإمكانك|تقدر) (أن )?(تخبرنا|تحدثنا|تخبرني|تحدثني|تكلمنا)( لنا)? عن/, 'احكِ عن'],
  [/^(هل )?(يمكنك|ممكن|تستطيع|بإمكانك|تقدر) (أن )?(تشرح|توضح)( لنا| لي)? (كيف|ما|لماذا|متى|أين)/, '$6'],
  [/^(حدثنا|حدثني|أخبرنا|أخبرني|كلمنا) عن/, 'احكِ عن'],
  [/^ما هي /, 'ما '],
  [/^ما هو /, 'ما '],
  [/بشكل عام/g, ''],
  [/على سبيل المثال/g, 'مثلًا'],
  [/بالإضافة إلى ذلك/g, 'و'],
  [/في الوقت الحالي/g, 'الآن'],
  [/خلال مسيرتك المهنية/g, 'في عملك'],
];

export function simplifyWithRules(text: string): Simplified {
  const known = catalog.get(normalizeArabic(text));
  if (known) return { simple: known, glosses: [], engine: 'catalog' };
  let simple = text.trim().replace(/\s+/g, ' ');
  for (const [pattern, replacement] of REWRITES) simple = simple.replace(pattern, replacement);
  // Long questions: split on commas/"و" into short sentences.
  const parts = simple.split(/[،,؛;]\s*|\s+و(?=(?:كيف|ما|لماذا|متى|أين|هل)\b)/).map(part => part.trim()).filter(Boolean);
  simple = parts.map(part => /[؟?.!]$/.test(part) ? part : part).join('. ').replace(/\s+/g, ' ').trim();
  if (!/[؟?]$/.test(simple) && /^(ما|ماذا|كيف|لماذا|متى|أين|هل|من|كم|احكِ)/.test(simple)) simple = `${simple.replace(/[.!]$/, '')}؟`;
  return { simple: simple || text, glosses: [], engine: 'rules' };
}

export async function simplifyQuestion(text: string, context: { jobTitle: string }): Promise<Simplified> {
  const clean = text.trim().slice(0, 1500);
  const known = catalog.get(normalizeArabic(clean));
  if (known && !llmAvailable()) return { simple: known, glosses: [], engine: 'catalog' };
  if (llmAvailable()) {
    try {
      const result = await structured({ schema: Schema, system: SYSTEM, content: `الوظيفة: ${context.jobTitle}\nكلام مسؤول التوظيف:\n<question>${clean}</question>`, effort: 'low', maxTokens: 2000 });
      if (result?.simple.trim()) return { simple: known ?? result.simple.trim(), glosses: result.glosses.map(item => item.trim()).filter(Boolean).slice(0, 20), engine: 'claude' };
    } catch (error) {
      console.warn('[interview] simplify failed, using rules:', describeLlmError(error));
    }
  }
  return simplifyWithRules(clean);
}
