// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer } from './audio-player';

const previousMediaSession = Object.getOwnPropertyDescriptor(navigator, 'mediaSession');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (previousMediaSession) {
    Object.defineProperty(navigator, 'mediaSession', previousMediaSession);
  } else {
    Reflect.deleteProperty(navigator, 'mediaSession');
  }
});

describe('AudioPlayer background controls', () => {
  it('publishes lock screen actions when playback starts', () => {
    const handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
    const mediaSession = {
      metadata: null,
      playbackState: 'none',
      setActionHandler: vi.fn(
        (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
          handlers.set(action, handler);
        },
      ),
    };
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: mediaSession,
    });
    vi.stubGlobal(
      'MediaMetadata',
      class {
        constructor(init: MediaMetadataInit) {
          Object.assign(this, init);
        }
      },
    );

    const { container } = render(
      <AudioPlayer src="blob:audio" fileName="audio.ogg" title="Ana" />,
    );
    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    fireEvent(audio!, new Event('play'));

    expect(mediaSession.setActionHandler).toHaveBeenCalled();
    expect(handlers.get('play')).toBeTypeOf('function');
    expect(handlers.get('pause')).toBeTypeOf('function');
    expect(handlers.get('seekbackward')).toBeTypeOf('function');
    expect(handlers.get('seekforward')).toBeTypeOf('function');
    expect(handlers.get('seekto')).toBeTypeOf('function');
    expect(mediaSession.playbackState).toBe('playing');

    fireEvent(audio!, new Event('pause'));
    expect(mediaSession.playbackState).toBe('paused');
  });
});
