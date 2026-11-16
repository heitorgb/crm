// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useConversationNavigation } from './use-conversation-navigation';

afterEach(cleanup);

function NavigationHarness() {
  const { selectedConversationId, selectConversation, deselectConversation } =
    useConversationNavigation();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div>
      <output data-testid="location">{location.pathname + location.search}</output>
      <output data-testid="selected">{selectedConversationId ?? 'lista'}</output>
      <button onClick={() => selectConversation('conversation-1')}>Abrir primeira</button>
      <button onClick={() => selectConversation('conversation-2')}>Abrir segunda</button>
      <button onClick={() => deselectConversation()}>Voltar pelo botão</button>
      <button onClick={() => navigate(-1)}>Voltar pelo gesto do sistema</button>
    </div>
  );
}

describe('useConversationNavigation', () => {
  it('returns to the conversation list using the browser back gesture', () => {
    render(
      <MemoryRouter initialEntries={['/atendimento/conversas']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir primeira' }));
    expect(screen.getByTestId('location').textContent).toBe(
      '/atendimento/conversas?conversation=conversation-1',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Voltar pelo gesto do sistema' }));
    expect(screen.getByTestId('location').textContent).toBe('/atendimento/conversas');
    expect(screen.getByTestId('selected').textContent).toBe('lista');
  });

  it('returns to the list by button, then allows opening another conversation', () => {
    render(
      <MemoryRouter initialEntries={['/atendimento/conversas']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir primeira' }));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar pelo botão' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir segunda' }));

    expect(screen.getByTestId('location').textContent).toBe(
      '/atendimento/conversas?conversation=conversation-2',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Voltar pelo gesto do sistema' }));
    expect(screen.getByTestId('selected').textContent).toBe('lista');
  });
});
