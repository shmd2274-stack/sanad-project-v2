import { useEffect, useRef, useState } from 'react';
import type { SignClip } from '@/hooks/use-interview-session';

/**
 * Plays the question as a sequence of Saudi Sign Language videos (SSL dataset, sshi.sa library).
 * Fingerspelled letters play faster; a word with no video shows its text for a moment.
 */
export function SignPlayer({ playlist, label }: { playlist: SignClip[]; label: string }) {
  const [index, setIndex] = useState(0);
  const [round, setRound] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const clip = playlist[index];

  useEffect(() => { setIndex(0); }, [playlist]);
  useEffect(() => {
    if (!clip) return;
    if (!clip.url) {
      const timer = window.setTimeout(() => setIndex(current => current + 1), 900);
      return () => window.clearTimeout(timer);
    }
    const element = video.current;
    if (!element) return undefined;
    element.playbackRate = clip.kind === 'letter' ? 1.6 : 1.15;
    void element.play().catch(() => undefined);
    return undefined;
  }, [clip, round]);

  if (!playlist.length) return null;
  const finished = index >= playlist.length;
  return <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80" aria-label={label}>
    {!finished && clip?.url && <video key={`${index}-${round}`} ref={video} src={clip.url} muted playsInline autoPlay className="max-h-full max-w-full object-contain" onEnded={() => setIndex(current => current + 1)} onError={() => setIndex(current => current + 1)} />}
    {!finished && clip && !clip.url && <span className="text-2xl font-semibold text-white">{clip.gloss}</span>}
    {!finished && clip && <span className="absolute bottom-2 rounded bg-black/70 px-2 py-0.5 text-sm text-white" aria-live="polite">{clip.gloss}{clip.kind === 'letter' ? ' · تهجئة' : ''}</span>}
    {finished && <button type="button" className="rounded-md border border-white/40 px-3 py-1.5 text-sm text-white hover:bg-white/10" onClick={() => { setIndex(0); setRound(current => current + 1); }}>إعادة عرض الإشارة</button>}
  </div>;
}
