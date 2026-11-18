import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { agentRuns } from '../db/schema';

/**
 * Tracks one CV through the agents, stage by stage (stored in agent_runs with agent = 'cv'),
 * so the account can see where it is and why a stage was skipped or failed.
 * Logs carry internal ids only — never the CV text, name or email.
 */
export type StageName = 'extract' | 'read' | 'ai' | 'titles' | 'match' | 'job_search';
export type StageStatus = 'running' | 'done' | 'skipped' | 'failed';
export interface PipelineStage { name: StageName; label: string; status: StageStatus; detail: string; at: string }

const LABELS: Record<StageName, string> = {
  extract: 'استخراج نص السيرة من الملف',
  read: 'قراءة السيرة (ATS): الخبرات والتدريب والتطوع والمشاريع والمهارات',
  ai: 'قراءة Claude والتحقق من الأدلة في نص السيرة',
  titles: 'تحديد المسميات الوظيفية المناسبة',
  match: 'مطابقة الوظائف وحساب نسبة التوافق',
  job_search: 'البحث عن وظائف جديدة في المصادر الموثوقة',
};

export function logEvent(scope: string, event: string, data: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ at: new Date().toISOString(), scope, event, ...data }));
}

export class CvPipeline {
  private stages: PipelineStage[] = [];
  private constructor(readonly id: string, private readonly userId: string, private readonly cvId: string) {}

  static async start(userId: string, cvId: string): Promise<CvPipeline> {
    const db = await getDb();
    const pipeline = new CvPipeline(randomUUID(), userId, cvId);
    await db.insert(agentRuns).values({ id: pipeline.id, agent: 'cv', userId, status: 'running', stats: { cvId, stages: [] } });
    logEvent('cv-pipeline', 'started', { run: pipeline.id, user: userId, cv: cvId });
    return pipeline;
  }

  async stage(name: StageName, status: StageStatus, detail = '') {
    const entry: PipelineStage = { name, label: LABELS[name], status, detail: detail.slice(0, 300), at: new Date().toISOString() };
    this.stages = [...this.stages.filter(stage => stage.name !== name), entry];
    const db = await getDb();
    await db.update(agentRuns).set({ stats: { cvId: this.cvId, stages: this.stages } }).where(eq(agentRuns.id, this.id));
    logEvent('cv-pipeline', `${name}:${status}`, { run: this.id, user: this.userId, detail: entry.detail });
  }

  async finish(status: 'succeeded' | 'failed', error?: string) {
    const db = await getDb();
    await db.update(agentRuns).set({ status, finishedAt: new Date(), error: error ?? null }).where(eq(agentRuns.id, this.id));
    logEvent('cv-pipeline', status, { run: this.id, user: this.userId, ...(error ? { error } : {}) });
  }
}
