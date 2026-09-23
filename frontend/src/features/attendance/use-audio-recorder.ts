import { useCallback, useEffect, useRef, useState } from 'react';

const RECORDER_MIME_CANDIDATES = [
  'audio/ogg;codecs=opus',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
];

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  return RECORDER_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'm4a';
  return 'webm';
}

interface UseAudioRecorderOptions {
  onComplete: (file: File) => void;
}

export function useAudioRecorder({ onComplete }: UseAudioRecorderOptions) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const release = useCallback((resetState: boolean) => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    if (resetState) {
      setRecording(false);
      setSeconds(0);
    }
  }, []);

  const start = useCallback(async () => {
    if (recording) {
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      setError('Gravação de áudio não é suportada neste navegador.');
      return;
    }

    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickRecorderMime();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      cancelledRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const chunks = chunksRef.current;
        const type = recorder.mimeType || 'audio/webm';
        const cancelled = cancelledRef.current;
        release(true);
        if (cancelled || chunks.length === 0) {
          return;
        }
        const blob = new Blob(chunks, { type });
        const file = new File([blob], `voice-${Date.now()}.${extensionForMime(type)}`, { type });
        onCompleteRef.current(file);
      };

      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch {
      release(true);
      setError('Não foi possível acessar o microfone.');
    }
  }, [recording, release]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    recorderRef.current?.stop();
  }, []);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      recorderRef.current?.stop();
      release(false);
    };
  }, [release]);

  return { recording, seconds, error, start, stop, cancel };
}
