/**
 * Voice dictation for Happyflow sheets via the browser's Web Speech API (Chrome, Edge, Safari).
 * No audio leaves the page through our code; the browser's own speech service transcribes it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type SpeechResultList = ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
type SpeechEvent = { resultIndex: number; results: SpeechResultList };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * `start(base)` dictates after `base`; `onText` receives the full text (base + final + interim)
 * on every update. `error` is a short human message when the mic is blocked or unavailable.
 */
export function useSpeech(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => {
    setSupported(getCtor() !== null);
    return () => recRef.current?.abort();
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback((base = "") => {
    const Ctor = getCtor();
    if (!Ctor) {
      setError("Voice input isn't supported in this browser.");
      return;
    }
    recRef.current?.abort();
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = base ? base.replace(/\s*$/, " ") : "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript.trim() + " ";
        else interim += r[0].transcript;
      }
      cb.current((finalText + interim).trimStart());
    };
    rec.onerror = (e) => {
      setError(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "Microphone access is blocked. Allow it in the browser to use voice."
          : e.error === "no-speech"
            ? "I didn't hear anything. Tap the mic and try again."
            : "Voice input stopped. Tap the mic to try again.",
      );
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setError(null);
    setListening(true);
    rec.start();
  }, []);

  return { supported, listening, error, start, stop };
}
