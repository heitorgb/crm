export const INITIAL_MESSAGE_VISIBLE_CHARS = 400;
export const MESSAGE_EXPANSION_STEP = 400;

export interface TruncatedMessageText {
  text: string;
  hasHiddenContent: boolean;
}

const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

function isWhitespace(value: string): boolean {
  return /^\s+$/.test(value);
}

interface CutBoundaries {
  hard: number | null;
  word: number | null;
}

function findCutBoundaries(text: string, visibleChars: number): CutBoundaries {
  const limit = Math.max(1, visibleChars);
  const minWordBoundary = Math.floor(limit * 0.6);
  const boundaries: CutBoundaries = { hard: null, word: null };

  if (segmenter) {
    let count = 0;
    for (const { segment, index } of segmenter.segment(text)) {
      count += 1;
      if (isWhitespace(segment) && count >= minWordBoundary && count <= limit) {
        boundaries.word = index + segment.length;
      }
      if (count === limit) {
        boundaries.hard = index + segment.length;
      }
      if (count > limit) {
        break;
      }
    }
    return boundaries;
  }

  let count = 0;
  let index = 0;
  while (index < text.length) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    const segment = String.fromCodePoint(codePoint);
    const end = index + segment.length;
    count += 1;
    if (isWhitespace(segment) && count >= minWordBoundary && count <= limit) {
      boundaries.word = end;
    }
    if (count === limit) {
      boundaries.hard = end;
    }
    if (count > limit) {
      break;
    }
    index = end;
  }
  return boundaries;
}

export function truncateMessageText(
  text: string,
  visibleChars: number,
): TruncatedMessageText {
  if (visibleChars >= text.length) {
    return { text, hasHiddenContent: false };
  }

  const { hard, word } = findCutBoundaries(text, visibleChars);
  if (hard === null) {
    return { text, hasHiddenContent: false };
  }

  const cut = word ?? hard;
  const remaining = text.slice(cut);
  if (remaining.trim().length === 0) {
    return { text, hasHiddenContent: false };
  }

  return { text: text.slice(0, cut), hasHiddenContent: true };
}
