import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionLike {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start: () => void; stop: () => void;
}
type SpeechCtor = new () => SpeechRecognitionLike;

/** The recruiter speaks; the browser's Arabic (ar-SA) speech recognition turns it into the question text. */
export function useSpeechToText(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    const ctor = (window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: SpeechCtor }).webkitSpeechRecognition;
    if (!ctor) return;
    const instance = new ctor();
    instance.lang = 'ar-SA'; instance.interimResults = true; instance.continuous = true;
    let finalText = '';
    instance.onresult = event => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]!;
        if (result.isFinal) finalText += `${result[0]?.transcript ?? ''} `; else interim += result[0]?.transcript ?? '';
      }
      onTextRef.current(`${finalText}${interim}`.trim());
    };
    instance.onend = () => { setListening(false); finalText = ''; };
    instance.onerror = () => setListening(false);
    recognition.current = instance;
    setSupported(true);
    return () => { instance.onend = null; try { instance.stop(); } catch { /* not started */ } };
  }, []);

  const toggle = useCallback(() => {
    const instance = recognition.current;
    if (!instance) return;
    if (listening) { instance.stop(); setListening(false); return; }
    try { instance.start(); setListening(true); } catch { setListening(false); }
  }, [listening]);

  return { supported, listening, toggle };
}
