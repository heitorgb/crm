// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthSession } from '@/types/auth';
import { LandingPage } from './landing-page';

const session: AuthSession = {
  accessToken: 'token',
  tokenType: 'Bearer',
  expiresIn: 900,
  expiresAt: Date.now() + 900_000,
  user: { id: 'user-1', name: 'Ana', email: 'ana@example.com', avatarUrl: null },
  tenant: { id: 'tenant-1', name: 'OrderUp' },
  role: 'OWNER',
  membershipId: 'member-1',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <LandingPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ session: null, status: 'unauthenticated', memberships: [], platformAdmin: false });
});

afterEach(() => {
  cleanup();
  document.head.querySelector('link[rel="canonical"]')?.remove();
});

describe('LandingPage', () => {
  it('renders the public landing page with the hero and main sections', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: /Todas as conversas.*Uma só operação/s }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Menos abas abertas/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Feito para o ritmo do seu atendimento/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Um plano desenhado para a sua operação/ })).toBeTruthy();
    expect(screen.getByText(/Sem cadastro público independente/i)).toBeTruthy();
  });

  it('links Entrar to the existing login route and plans to the plans section', () => {
    renderPage();

    const loginLinks = screen.getAllByRole('link', { name: 'Entrar' });

    expect(loginLinks.length).toBeGreaterThan(0);
    loginLinks.forEach((link) => {
      expect(link.getAttribute('href')).toBe('/login');
    });

    const plansLinks = screen.getAllByRole('link', { name: /Conhecer planos/ });
    expect(plansLinks.length).toBeGreaterThan(0);
    plansLinks.forEach((link) => {
      expect(link.getAttribute('href')).toBe('#planos');
    });

    expect(screen.getByRole('link', { name: /Falar com o comercial/ }).getAttribute('href')).toContain(
      'https://wa.me/5561998001384',
    );
  });

  it('does not expose an independent public signup entry point', () => {
    renderPage();

    expect(screen.queryByRole('link', { name: /criar conta|cadastrar|começar grátis/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /criar conta|cadastrar|começar grátis/i })).toBeNull();
  });

  it('offers the authenticated area when a session already exists', () => {
    useAuthStore.setState({ session, status: 'authenticated' });

    renderPage();

    const entryLinks = screen.getAllByRole('link', { name: 'Abrir plataforma' });

    expect(entryLinks.length).toBeGreaterThan(0);
    entryLinks.forEach((link) => {
      expect(link.getAttribute('href')).toBe('/atendimento/conversas');
    });
  });

  it('opens and closes the mobile navigation', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }));

    expect(screen.getByRole('button', { name: 'Fechar menu' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Navegação principal no celular' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Fechar menu' }));

    expect(screen.getByRole('button', { name: 'Abrir menu' })).toBeTruthy();
  });

  it('sets landing metadata for search and sharing', () => {
    renderPage();

    expect(document.title).toContain('OrderUp CRM');
    expect(document.title).toContain('Atendimento');
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://crm.orderup.com.br/',
    );
    expect(document.head.querySelector('meta[property="og:title"]')?.getAttribute('content')).toContain(
      'OrderUp CRM',
    );
  });
});
