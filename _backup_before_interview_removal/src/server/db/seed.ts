import { jobs as builtInJobs, liveQuestionSets } from '@/lib/sanad-data';
import type { Db } from './client';
import { jobs } from './schema';

/** Idempotent: inserts the built-in jobs once; never overwrites later edits. */
export async function seedDatabase(db: Db) {
  await db.insert(jobs).values(builtInJobs.map(job => ({
    id: job.id,
    title: job.title,
    english: job.english,
    company: job.company,
    mark: job.mark,
    location: job.location,
    mode: job.mode,
    salary: job.salary,
    description: job.description,
    skills: [...job.skills],
    tone: job.tone,
    source: 'sanad',
    sourceName: 'سَند',
    deafFriendlyReason: 'وظيفة شريكة في سَند: تواصل كتابي ومقابلة مدعومة بلغة الإشارة.',
    accommodations: ['أسئلة مكتوبة وواضحة', 'وقت كافٍ للمراجعة', 'اتصال مرئي مناسب', 'تواصل كتابي في العمل'],
    interviewQuestions: liveQuestionSets[job.id] ?? [],
    fingerprint: `seed:${job.id}`,
  }))).onConflictDoNothing();
}
