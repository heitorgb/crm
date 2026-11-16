// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaPreviewDialog } from './media-preview-dialog';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MediaPreviewDialog', () => {
  it('keeps long video previews constrained to a mobile viewport', () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:video-preview'),
      revokeObjectURL: vi.fn(),
    });
    const file = new File(['video'], `${'video-'.repeat(20)}.mp4`, { type: 'video/mp4' });

    render(
      <MediaPreviewDialog
        file={file}
        open
        sending={false}
        error={null}
        initialCaption=""
        onOpenChange={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const video = dialog.querySelector('video');
    const description = screen.getByText(file.name);

    expect(dialog.className).toContain('w-[calc(100vw-2rem)]');
    expect(dialog.className).toContain('max-h-[calc(100dvh-2rem)]');
    expect(video?.className).toContain('min-w-0');
    expect(video?.className).toContain('max-w-full');
    expect(description.className).toContain('truncate');
  });
});
