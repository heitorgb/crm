// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ExpandableText } from './expandable-text';

afterEach(cleanup);

function buildText(prefix: string, words = 240): string {
  return Array.from({ length: words }, (_, index) => `${prefix}${index}`).join(' ');
}

function expandFully(container: HTMLElement = document.body): void {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const button = within(container).queryByRole('button', { name: 'Ler mais' });
    if (!button) {
      return;
    }
    fireEvent.click(button);
  }
  throw new Error('A mensagem não foi totalmente expandida');
}

describe('ExpandableText', () => {
  it('renders short text without the action', () => {
    render(<ExpandableText text="Olá, tudo bem?" />);

    expect(screen.getByText('Olá, tudo bem?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ler mais' })).toBeNull();
  });

  it('collapses long text and reveals it progressively', () => {
    const text = buildText('palavra');
    render(<ExpandableText text={text} />);

    const firstChunk = screen.getByText(/^palavra0/).textContent ?? '';
    expect(firstChunk.length).toBeLessThan(text.length);

    fireEvent.click(screen.getByRole('button', { name: 'Ler mais' }));
    const secondChunk = screen.getByText(/^palavra0/).textContent ?? '';
    expect(secondChunk.length).toBeGreaterThan(firstChunk.length);

    expandFully();

    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ler mais' })).toBeNull();
  });

  it('keeps expansion state independent per rendered message', () => {
    const first = buildText('primeira');
    const second = buildText('segunda');
    const firstRender = render(<ExpandableText text={first} />);
    const secondRender = render(<ExpandableText text={second} />);

    const secondBefore = within(secondRender.container).getByText(/^segunda0/).textContent;

    fireEvent.click(within(firstRender.container).getByRole('button', { name: 'Ler mais' }));

    const secondAfter = within(secondRender.container).getByText(/^segunda0/).textContent;
    expect(secondAfter).toBe(secondBefore);
    expect(within(firstRender.container).getByRole('button', { name: 'Ler mais' })).toBeTruthy();
    expect(within(secondRender.container).getByRole('button', { name: 'Ler mais' })).toBeTruthy();

    expandFully(firstRender.container);
    expect(within(firstRender.container).getByText(first)).toBeTruthy();
    expect(within(firstRender.container).queryByRole('button', { name: 'Ler mais' })).toBeNull();
    expect(within(secondRender.container).queryByText(second)).toBeNull();
    expect(within(secondRender.container).getByRole('button', { name: 'Ler mais' })).toBeTruthy();
  });

  it('preserves links, line breaks and emojis in the expanded content', () => {
    const text = `${buildText('linha')}\n\n😀 https://exemplo.com/artigo`;
    render(<ExpandableText text={text} />);

    expect(screen.queryByText('https://exemplo.com/artigo')).toBeNull();

    expandFully();

    const link = screen.getByText('https://exemplo.com/artigo').closest('a');
    expect(link?.href).toBe('https://exemplo.com/artigo');
    expect(screen.getByText(/^linha0/).textContent).toContain('\n\n😀 ');
  });

  it('recalculates the hidden content after the message changes', () => {
    const longText = buildText('antes');
    const { rerender } = render(<ExpandableText text={longText} />);

    expect(screen.getByRole('button', { name: 'Ler mais' })).toBeTruthy();

    rerender(<ExpandableText text="Atualizada" />);
    expect(screen.queryByRole('button', { name: 'Ler mais' })).toBeNull();
    expect(screen.getByText('Atualizada')).toBeTruthy();

    rerender(<ExpandableText text={buildText('depois')} />);
    expect(screen.getByRole('button', { name: 'Ler mais' })).toBeTruthy();
  });
});
