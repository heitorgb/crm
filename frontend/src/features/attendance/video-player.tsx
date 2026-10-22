import { useState } from 'react';
import { AlertCircle, Download, Loader2, Play } from 'lucide-react';

interface VideoPlayerProps {
  src: string | null;
  posterUrl: string | null;
  fileName: string;
  loading: boolean;
  unavailable: boolean;
  downloading: boolean;
  onPlay: () => void;
  onDownload: () => void;
}

export function VideoPlayer({
  src,
  posterUrl,
  fileName,
  loading,
  unavailable,
  downloading,
  onPlay,
  onDownload,
}: VideoPlayerProps) {
  const [playbackFailed, setPlaybackFailed] = useState(false);

  if (unavailable || playbackFailed) {
    return (
      <div className="flex aspect-video w-72 max-w-full flex-col items-center justify-center gap-1.5 rounded-md bg-muted px-4 text-center">
        <AlertCircle className="size-5 text-muted-foreground" aria-hidden />
        <p role="alert" className="text-[11px] leading-snug text-muted-foreground">
          Não foi possível reproduzir este vídeo.
        </p>
        <p className="max-w-full truncate text-[10px] text-muted-foreground/80" title={fileName}>
          {fileName}
        </p>
        <button
          type="button"
          onClick={onDownload}
          disabled={downloading}
          className="mt-0.5 inline-flex items-center gap-1.5 rounded-full bg-foreground/10 px-2.5 py-1 text-[11px] font-medium text-foreground transition hover:bg-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {downloading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Download className="size-3.5" aria-hidden />
          )}
          Baixar vídeo
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-72 max-w-full overflow-hidden rounded-md bg-muted">
      {src ? (
        <>
          <video
            src={src}
            poster={posterUrl ?? undefined}
            controls
            autoPlay
            playsInline
            preload="metadata"
            aria-label={`Vídeo: ${fileName}`}
            className="block aspect-video w-full bg-slate-950 object-contain"
            onError={() => setPlaybackFailed(true)}
          />
          {loading ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/35">
              <Loader2 className="size-5 animate-spin text-white" aria-hidden />
              <span className="sr-only">Carregando vídeo</span>
            </div>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          onClick={onPlay}
          aria-label={loading ? 'Carregando vídeo' : 'Reproduzir vídeo'}
          className="group relative flex aspect-video w-full items-center justify-center overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {posterUrl ? (
            <img
              src={posterUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              draggable={false}
            />
          ) : null}
          <span className="absolute inset-0 bg-black/5 transition group-hover:bg-black/10" />
          <span className="relative z-10 flex size-11 items-center justify-center rounded-full bg-white/95 text-slate-950 shadow-md ring-1 ring-black/10 backdrop-blur-sm transition group-hover:scale-105 group-hover:bg-white">
            {loading ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : (
              <Play className="ml-0.5 size-5 fill-current" aria-hidden />
            )}
          </span>
        </button>
      )}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDownload();
        }}
        disabled={downloading}
        aria-label="Baixar vídeo"
        title="Baixar vídeo"
        className="absolute right-1.5 top-1.5 z-20 flex size-7 items-center justify-center rounded-full bg-black/35 text-white shadow-sm ring-1 ring-white/10 backdrop-blur-sm transition hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {downloading ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Download className="size-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}
