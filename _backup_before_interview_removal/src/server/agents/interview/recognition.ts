import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as z from 'zod/v4';
import { env } from '../../env';
import { describeLlmError, llmAvailable, structured } from '../llm';
import { signCapabilities } from './capabilities';
import { vocabularyFor } from './ssl-lexicon';

export interface Recognition {
  understood: boolean;
  text: string;
  glosses: string[];
  /** 0–1. Below CONFIDENCE_FLOOR the answer counts as "not understood". */
  confidence: number;
  engine: 'landmarks' | 'vision' | 'none';
  note: string;
}
export const CONFIDENCE_FLOOR = 0.35;

interface Context { original: string; simple: string; jobTitle: string }

const VisionSchema = z.object({
  understood: z.boolean().describe('false إذا لم تظهر إشارات واضحة أو لم تتمكن من فهمها'),
  glosses: z.array(z.string()).describe('الإشارات التي تعرفت عليها بالترتيب، بأسمائها العربية'),
  sentence: z.string().describe('الجملة العربية التي عبّر عنها المرشح بصيغة المتكلم، كما أشار بالضبط'),
  confidence: z.number().describe('من 0 إلى 1'),
  uncertainty: z.string().describe('ما الذي لم يكن واضحًا، باختصار'),
});

const VISION_SYSTEM = `أنت "سَند"، مترجم لغة الإشارة السعودية في مقابلات العمل.
تصلك صور متتابعة (بالترتيب الزمني) من كاميرا مرشح أصم يجيب بلغة الإشارة السعودية عن سؤال مقابلة.
حلّل شكل اليد وحركتها وموضعها وتعابير الوجه، ثم:
- glosses: الإشارات التي تعرفت عليها، وفضّل أسماء الإشارات من المفردات المقترحة.
- sentence: ما قاله المرشح فعلًا بجملة عربية فصحى بسيطة بصيغة المتكلم. السؤال سياق فقط لتمييز الإشارات المتشابهة؛ لا تكتب إجابة "جيدة" من عندك ولا تضف معلومة لم يُشر بها.
- إن لم تظهر اليدان، أو كانت الصور غير واضحة أو قليلة، أو لم تفهم: understood=false وconfidence منخفضة وsentence فارغة.
المرشح سيراجع الجملة ويؤكدها قبل إرسالها، لذلك الأمانة أهم من الاكتمال.`;

async function recognizeWithVision(frames: string[], context: Context): Promise<Recognition> {
  const vocabulary = vocabularyFor(`${context.original} ${context.simple}`, context.jobTitle);
  const picked = frames.length > 16 ? Array.from({ length: 16 }, (_, index) => frames[Math.round(index * (frames.length - 1) / 15)]!) : frames;
  const result = await structured({
    schema: VisionSchema,
    system: VISION_SYSTEM,
    effort: 'medium',
    maxTokens: 4000,
    content: [
      { type: 'text', text: `الوظيفة: ${context.jobTitle}\nسؤال المقابلة: ${context.original}\nالسؤال المبسط: ${context.simple}\nمفردات إشارة محتملة: ${vocabulary.join('، ')}\nالصور التالية بالترتيب (${picked.length} صورة):` },
      ...picked.map(data => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data } })),
    ],
  });
  if (!result) return { understood: false, text: '', glosses: [], confidence: 0, engine: 'vision', note: 'declined' };
  const confidence = Math.max(0, Math.min(1, result.confidence));
  const understood = result.understood && confidence >= CONFIDENCE_FLOOR && Boolean(result.sentence.trim());
  return { understood, text: understood ? result.sentence.trim() : '', glosses: result.glosses, confidence, engine: 'vision', note: result.uncertainty };
}

/** Python + MediaPipe recognizer (scripts/ssl/recognize.py) matching against the SSL landmark index. */
async function recognizeWithLandmarks(frames: string[], context: Context): Promise<Recognition> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanad-sign-'));
  try {
    frames.forEach((frame, index) => fs.writeFileSync(path.join(dir, `${String(index).padStart(4, '0')}.jpg`), Buffer.from(frame, 'base64')));
    const vocabulary = vocabularyFor(`${context.original} ${context.simple}`, context.jobTitle, 400);
    fs.writeFileSync(path.join(dir, 'vocab.json'), JSON.stringify(vocabulary));
    const script = path.resolve(process.cwd(), 'scripts', 'ssl', 'recognize.py');
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(env.sslPython!, [script, '--index', env.sslLandmarkIndex, '--frames', dir, '--vocab', path.join(dir, 'vocab.json')], { timeout: 60_000 });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`recognize.py exited ${code}: ${stderr.slice(-400)}`)));
    });
    const parsed = JSON.parse(output) as { glosses: { label: string; score: number }[] };
    const glosses = parsed.glosses.map(item => item.label);
    const confidence = parsed.glosses.length ? parsed.glosses.reduce((sum, item) => sum + item.score, 0) / parsed.glosses.length : 0;
    if (!glosses.length || confidence < CONFIDENCE_FLOOR) return { understood: false, text: '', glosses, confidence, engine: 'landmarks', note: 'low_confidence' };
    return { understood: true, text: await composeSentence(glosses, context), glosses, confidence, engine: 'landmarks', note: '' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ComposeSchema = z.object({ sentence: z.string() });

/** Recognised glosses (sign order) → a natural Arabic sentence, using the question as context. */
export async function composeSentence(glosses: string[], context: Context): Promise<string> {
  if (llmAvailable()) {
    try {
      const result = await structured({
        schema: ComposeSchema,
        system: 'حوّل تسلسل إشارات من لغة الإشارة السعودية إلى جملة عربية فصحى بسيطة بصيغة المتكلم. استخدم الإشارات فقط ولا تضف معلومات جديدة؛ السؤال للسياق فقط.',
        content: `السؤال: ${context.original}\nالإشارات بالترتيب: ${glosses.join(' | ')}`,
        effort: 'low',
        maxTokens: 1000,
      });
      if (result?.sentence.trim()) return result.sentence.trim();
    } catch (error) { console.warn('[interview] compose failed:', describeLlmError(error)); }
  }
  return glosses.join(' ');
}

export async function recognizeSigning(frames: string[], context: Context): Promise<Recognition> {
  const usable = frames.filter(frame => frame.length > 1000).slice(0, 48);
  if (usable.length < 3) return { understood: false, text: '', glosses: [], confidence: 0, engine: 'none', note: 'too_few_frames' };
  const mode = signCapabilities().signRecognition;
  try {
    if (mode === 'landmarks') {
      const result = await recognizeWithLandmarks(usable, context);
      if (result.understood || !llmAvailable()) return result;
    }
    if (llmAvailable()) return await recognizeWithVision(usable, context);
  } catch (error) {
    console.warn('[interview] recognition failed:', describeLlmError(error));
    return { understood: false, text: '', glosses: [], confidence: 0, engine: mode === 'landmarks' ? 'landmarks' : 'vision', note: 'engine_error' };
  }
  return { understood: false, text: '', glosses: [], confidence: 0, engine: 'none', note: 'no_engine' };
}
