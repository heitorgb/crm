import { useEffect } from 'react';

interface PageMetadata {
  title: string;
  description: string;
  canonical?: string;
  robots?: string;
}

function upsertMeta(attribute: 'name' | 'property', key: string, content: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);

  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }

  element.setAttribute('content', content);
}

function updateCanonical(href: string | undefined): void {
  const selector = 'link[rel="canonical"]';
  const existing = document.head.querySelector<HTMLLinkElement>(selector);

  if (!href) {
    existing?.remove();
    return;
  }

  const element = existing ?? document.createElement('link');
  element.rel = 'canonical';
  element.href = href;

  if (!existing) {
    document.head.appendChild(element);
  }
}

export function useNoIndex(): void {
  useEffect(() => {
    upsertMeta('name', 'robots', 'noindex, nofollow');
    updateCanonical(undefined);
  }, []);
}

export function usePageMetadata({
  title,
  description,
  canonical,
  robots = 'index, follow',
}: PageMetadata): void {
  useEffect(() => {
    document.title = title;
    upsertMeta('name', 'description', description);
    upsertMeta('name', 'robots', robots);
    updateCanonical(canonical);

    if (canonical) {
      upsertMeta('property', 'og:title', title);
      upsertMeta('property', 'og:description', description);
      upsertMeta('property', 'og:url', canonical);
      upsertMeta('property', 'og:type', 'website');
      upsertMeta('property', 'og:site_name', 'OrderUp CRM');
      upsertMeta('property', 'og:locale', 'pt_BR');
      upsertMeta('property', 'og:image', `${canonical}images/logo-orderup.png`);
      upsertMeta('name', 'twitter:card', 'summary');
      upsertMeta('name', 'twitter:title', title);
      upsertMeta('name', 'twitter:description', description);
    }
  }, [title, description, canonical, robots]);
}
