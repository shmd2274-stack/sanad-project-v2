import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';

export interface SignClip { gloss: string; videoId: string | null; url: string | null; kind: 'word' | 'letter' | 'missing'; duration?: number }
export interface ServerQuestion { id: string; seq: number; original: string; simple: string; playlist: SignClip[] }
export interface Recognition { answerId: string; understood: boolean; text: string; confidence: number; engine: string; note: string; misunderstandings: number; interpreter: string }
interface SessionEvent { id: number; type: string; payload: Record<string, unknown> }

/**
 * Live interview session on the server: questions are simplified and translated into
 * Saudi Sign Language, signed answers are recognised, and only answers the candidate
 * approves (👍) reach the recruiter. Inactive (returns `active: false`) for guests and tests.
 */
export function useInterviewSession({ jobId, preview, communication, enabled, onEvent }: {
  jobId: string; preview: boolean; communication: 'sign' | 'text'; enabled: boolean;
  onEvent?: (event: SessionEvent) => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recruiterToken, setRecruiterToken] = useState<string | null>(null);
  const [interpreter, setInterpreter] = useState<'standby' | 'joined'>('standby');
  const [error, setError] = useState('');
  const asked = useRef(new Map<string, Promise<ServerQuestion | null>>());
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api<{ sessionId: string; recruiterToken: string }>('POST', '/interviews', { jobId, preview, communication })
      .then(result => { if (!cancelled) { setSessionId(result.sessionId); setRecruiterToken(result.recruiterToken); } })
      .catch(failure => { if (!cancelled) setError(errorMessage(failure)); });
    return () => { cancelled = true; };
  }, [enabled, jobId, preview, communication]);

  // Long-poll the session's events (interpreter joining, questions from the recruiter's device, reactions).
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    let after = 0;
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const { events } = await api<{ events: SessionEvent[] }>('GET', `/interviews/${sessionId}/events?after=${after}&wait=20000`, undefined, { signal: controller.signal });
          for (const event of events) {
            after = Math.max(after, event.id);
            if (event.type === 'interpreter_joined') setInterpreter('joined');
            onEventRef.current?.(event);
          }
        } catch {
          if (controller.signal.aborted) return;
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    })();
    return () => controller.abort();
  }, [sessionId]);

  /** Simplifies the question and builds its SSL playlist. Each distinct question is sent once. */
  const ask = useCallback((original: string, simple?: string): Promise<ServerQuestion | null> => {
    if (!sessionId || !original.trim()) return Promise.resolve(null);
    const key = `${original}\u0000${simple ?? ''}`;
    const existing = asked.current.get(key);
    if (existing) return existing;
    const request = api<ServerQuestion>('POST', `/interviews/${sessionId}/questions`, { text: original, ...(simple ? { simple } : {}) })
      .catch(failure => { setError(errorMessage(failure)); asked.current.delete(key); return null; });
    asked.current.set(key, request);
    return request;
  }, [sessionId]);

  const recognize = useCallback(async (questionId: string, frames: string[]) => {
    if (!sessionId) return null;
    const result = await api<Recognition>('POST', `/interviews/${sessionId}/answers/recognize`, { questionId, frames });
    if (result.interpreter === 'joined') setInterpreter('joined');
    return result;
  }, [sessionId]);

  /** 👍 (approved) or 👎. A typed answer is registered first, then approved. */
  const decide = useCallback(async (input: { answerId?: string | undefined; questionId: string; text: string; approved: boolean }) => {
    if (!sessionId) return null;
    let answerId = input.answerId;
    if (!answerId) answerId = (await api<{ answerId: string }>('POST', `/interviews/${sessionId}/answers/text`, { questionId: input.questionId, text: input.text })).answerId;
    const result = await api<{ status: string; misunderstandings: number; interpreter: string }>('POST', `/interviews/${sessionId}/answers/${answerId}/decision`, { approved: input.approved, text: input.text });
    if (result.interpreter === 'joined') setInterpreter('joined');
    return result;
  }, [sessionId]);

  const requestInterpreter = useCallback(() => {
    if (!sessionId) return;
    void api('POST', `/interviews/${sessionId}/interpreter`).then(() => setInterpreter('joined')).catch(failure => setError(errorMessage(failure)));
  }, [sessionId]);

  const react = useCallback((reactionId: string, sender: 'candidate' | 'recruiter') => {
    if (sessionId) void api('POST', `/interviews/${sessionId}/reactions`, { reactionId, sender }).catch(() => undefined);
  }, [sessionId]);

  const endPreview = useCallback((durationSeconds: number) => {
    if (sessionId) void api('POST', `/interviews/${sessionId}/end`, { durationSeconds }).catch(() => undefined);
  }, [sessionId]);

  return { active: enabled && Boolean(sessionId), sessionId, recruiterToken, interpreter, error, ask, recognize, decide, requestInterpreter, react, endPreview };
}
