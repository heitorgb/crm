type AudioContextConstructor = typeof AudioContext;

let context: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }
  if (context) {
    return context;
  }

  const globalWindow = window as Window & { webkitAudioContext?: AudioContextConstructor };
  const AudioContextCtor = window.AudioContext ?? globalWindow.webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }

  context = new AudioContextCtor();
  return context;
}

/** Resumes the audio context on the first user gesture so later sounds can play. */
export function primeNotificationSound(): void {
  const audio = getAudioContext();
  if (audio && audio.state === 'suspended') {
    void audio.resume();
  }
}

/** Plays a short two-tone chime, similar to a messaging notification. */
export function playNotificationSound(): void {
  const audio = getAudioContext();
  if (!audio) {
    return;
  }
  if (audio.state === 'suspended') {
    void audio.resume();
  }

  const now = audio.currentTime;
  const gain = audio.createGain();
  gain.connect(audio.destination);

  const notes = [
    { frequency: 880, start: 0, duration: 0.12 },
    { frequency: 1318.5, start: 0.11, duration: 0.16 },
  ];

  for (const note of notes) {
    const oscillator = audio.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(note.frequency, now + note.start);
    oscillator.connect(gain);
    oscillator.start(now + note.start);
    oscillator.stop(now + note.start + note.duration);
  }

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
}
