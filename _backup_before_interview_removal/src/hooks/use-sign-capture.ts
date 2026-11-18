import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const FRAME_INTERVAL_MS = 250;
const MAX_FRAMES = 48;
const FRAME_WIDTH = 480;

/**
 * Samples the local camera preview into JPEG frames while the candidate signs.
 * Frames stay in memory and are sent only to Sanad's recogniser for this answer; nothing is recorded.
 */
export function useSignCapture(videoRef: RefObject<HTMLVideoElement | null>) {
  const [capturing, setCapturing] = useState(false);
  const frames = useRef<string[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  const grab = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    canvas.current ??= document.createElement('canvas');
    const scale = FRAME_WIDTH / video.videoWidth;
    canvas.current.width = FRAME_WIDTH;
    canvas.current.height = Math.round(video.videoHeight * scale);
    const context = canvas.current.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.current.width, canvas.current.height);
    frames.current.push(canvas.current.toDataURL('image/jpeg', 0.72));
    if (frames.current.length > MAX_FRAMES) frames.current.splice(0, frames.current.length - MAX_FRAMES);
  }, [videoRef]);

  const start = useCallback(() => {
    frames.current = [];
    window.clearInterval(timer.current);
    timer.current = window.setInterval(grab, FRAME_INTERVAL_MS);
    setCapturing(true);
  }, [grab]);

  const stop = useCallback((): string[] => {
    window.clearInterval(timer.current);
    setCapturing(false);
    const captured = frames.current;
    frames.current = [];
    return captured;
  }, []);

  useEffect(() => () => window.clearInterval(timer.current), []);
  return { capturing, start, stop };
}
