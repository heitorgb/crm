import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationMessage, LinkPreview } from '@/types/attendance';
import { readLinkPreviewMetadata } from './link-preview-utils';
import { extractPreviewUrls } from './linkify-text';
import { useLinkPreview } from './queries';

interface MessageLinkPreviewProps {
  message: ConversationMessage;
  isOutbound: boolean;
}

export function MessageLinkPreview({ message, isOutbound }: MessageLinkPreviewProps) {
  const metadataPreview = useMemo(
    () => readLinkPreviewMetadata(message.metadata),
    [message.metadata],
  );
  const urls = useMemo(
    () => (metadataPreview ? [] : extractPreviewUrls(message.content ?? '')),
    [message.content, metadataPreview],
  );

  if (metadataPreview) {
    return <LinkPreviewCard preview={metadataPreview} isOutbound={isOutbound} />;
  }

  const url = urls[0];
  if (!url) {
    return null;
  }

  return <FetchedLinkPreview url={url} isOutbound={isOutbound} />;
}

function FetchedLinkPreview({ url, isOutbound }: { url: string; isOutbound: boolean }) {
  const { data, isLoading } = useLinkPreview(url);

  if (isLoading) {
    return <LinkPreviewSkeleton isOutbound={isOutbound} />;
  }
  if (!data) {
    return null;
  }

  return <LinkPreviewCard preview={data} isOutbound={isOutbound} />;
}

interface ComposerLinkPreviewProps {
  url: string;
  onRemove: () => void;
}

/**
 * Preview shown above the composer, using the metadata resolved by the
 * backend. It never blocks sending: while loading it shows a skeleton and it
 * disappears when the URL has no usable metadata or the request fails.
 */
export function ComposerLinkPreview({ url, onRemove }: ComposerLinkPreviewProps) {
  const { data, isLoading, isError } = useLinkPreview(url);

  if (isError) {
    return null;
  }
  if (isLoading) {
    return (
      <div className="relative">
        <LinkPreviewSkeleton isOutbound={false} />
        <RemovePreviewButton onRemove={onRemove} />
      </div>
    );
  }
  if (!data) {
    return null;
  }

  return (
    <div className="relative">
      <LinkPreviewCard preview={data} isOutbound={false} />
      <RemovePreviewButton onRemove={onRemove} />
    </div>
  );
}

function RemovePreviewButton({ onRemove }: { onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label="Remover pré-visualização do link"
      className="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/55 p-1 text-white shadow-sm transition hover:bg-black/70"
    >
      <X className="size-3.5" />
    </button>
  );
}

interface LinkPreviewCardProps {
  preview: LinkPreview;
  isOutbound: boolean;
}

export function LinkPreviewCard({ preview, isOutbound }: LinkPreviewCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(preview.imageUrl) && !imageFailed;
  const hasContent = Boolean(preview.title || preview.description || preview.domain);

  if (!showImage && !hasContent) {
    return null;
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'mt-1.5 block w-full max-w-full overflow-hidden rounded-md border text-left transition-[filter] hover:brightness-95',
        isOutbound
          ? 'border-black/10 bg-black/5 dark:border-white/10 dark:bg-black/20'
          : 'border-border bg-surface/80',
      )}
    >
      {showImage ? (
        <div className="w-full overflow-hidden bg-muted">
          <img
            src={preview.imageUrl ?? undefined}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-32 w-full object-cover sm:h-36"
            onError={() => setImageFailed(true)}
          />
        </div>
      ) : null}
      <div className="space-y-0.5 px-2.5 py-2">
        {preview.siteName ? (
          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {preview.siteName}
          </p>
        ) : null}
        {preview.title ? (
          <p className="line-clamp-2 text-xs font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
            {preview.title}
          </p>
        ) : null}
        {preview.description ? (
          <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
            {preview.description}
          </p>
        ) : null}
        <p className="truncate text-[10px] leading-tight text-info">{preview.domain}</p>
      </div>
    </a>
  );
}

function LinkPreviewSkeleton({ isOutbound }: { isOutbound: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        'mt-1.5 flex w-full animate-pulse overflow-hidden rounded-md border',
        isOutbound
          ? 'border-black/10 bg-black/5 dark:border-white/10 dark:bg-black/20'
          : 'border-border bg-surface/80',
      )}
    >
      <div className="size-16 shrink-0 bg-muted" />
      <div className="flex-1 space-y-1.5 p-2">
        <div className="h-2 w-1/3 rounded bg-muted" />
        <div className="h-2.5 w-4/5 rounded bg-muted" />
        <div className="h-2 w-3/5 rounded bg-muted" />
      </div>
    </div>
  );
}
