import { useRef, useState } from "react";
import { Download, Pause, Play } from "lucide-react";

function audioTime(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function AudioPlayer({
  src,
  fileName,
}: {
  src: string;
  fileName: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState(false);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      setError(false);
      await audio.play();
    } catch {
      setError(true);
    }
  };

  return (
    <div className="w-72 max-w-full">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(event) => {
          setPlaying(false);
          if (Number.isFinite(event.currentTarget.duration))
            setTime(event.currentTarget.duration);
        }}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onDurationChange={(event) => {
          if (Number.isFinite(event.currentTarget.duration))
            setDuration(event.currentTarget.duration);
        }}
        onError={() => {
          setError(true);
          setPlaying(false);
        }}
      />
      <div className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => void toggle()}
          aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
        </button>
        <input
          type="range"
          aria-label="Posição do áudio"
          className="m-0 block h-10 w-full min-w-0 cursor-pointer accent-current"
          min={0}
          max={duration || 1}
          step="any"
          value={Math.min(time, duration || 1)}
          disabled={!duration}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (audioRef.current) audioRef.current.currentTime = value;
            setTime(value);
          }}
        />
        <div className="col-start-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] tabular-nums opacity-75">
            {audioTime(time)} / {audioTime(duration)}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={`Velocidade do áudio: ${rate} vezes`}
              className="shrink-0 rounded-full bg-foreground/10 px-2 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
                setRate(next);
                if (audioRef.current) audioRef.current.playbackRate = next;
              }}
            >
              {String(rate).replace(".", ",")}×
            </button>
            <a
              href={src}
              download={fileName}
              aria-label="Baixar áudio"
              title="Baixar áudio"
              className="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Download className="size-4" />
            </a>
          </div>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-xs">
          Não foi possível reproduzir o áudio.
        </p>
      ) : null}
    </div>
  );
}
