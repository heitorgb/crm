import { describe, expect, it } from 'vitest';
import { truncateMessageText } from './message-expansion';

describe('truncateMessageText', () => {
  it('keeps short messages untouched', () => {
    expect(truncateMessageText('Mensagem curta', 400)).toEqual({
      text: 'Mensagem curta',
      hasHiddenContent: false,
    });
  });

  it('cuts long messages at a word boundary', () => {
    const result = truncateMessageText('alpha beta gamma delta', 12);

    expect(result.text).toBe('alpha beta ');
    expect(result.hasHiddenContent).toBe(true);
  });

  it('never splits a grapheme cluster', () => {
    const result = truncateMessageText('😀abc', 1);

    expect(result.text).toBe('😀');
    expect(result.hasHiddenContent).toBe(true);
  });

  it('keeps a full emoji sequence in the first chunk', () => {
    const family = '👨‍👩‍👧‍👦';
    const result = truncateMessageText(`${family}abc`, 1);

    expect(result.text).toBe(family);
  });

  it('treats whitespace-only remainders as fully visible', () => {
    const text = 'mensagem'.padEnd(20, ' ');
    const result = truncateMessageText(text, 8);

    expect(result).toEqual({ text, hasHiddenContent: false });
  });

  it('returns everything when the limit covers all graphemes', () => {
    const text = '😀😀 texto longo';
    expect(truncateMessageText(text, text.length)).toEqual({
      text,
      hasHiddenContent: false,
    });
  });
});
