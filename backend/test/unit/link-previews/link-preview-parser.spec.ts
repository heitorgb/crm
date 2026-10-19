import { parseLinkPreviewHtml } from '../../../src/modules/link-previews/link-preview-parser.js';

describe('parseLinkPreviewHtml', () => {
  it('extracts complete Open Graph metadata', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Título da página" />
        <meta name="og:description" content="Descrição resumida do conteúdo." />
        <meta property="og:image" content="/imagens/capa.png" />
        <meta property="og:site_name" content="Exemplo" />
      </head></html>
    `;

    expect(parseLinkPreviewHtml(html, 'https://www.exemplo.com/artigo')).toEqual({
      title: 'Título da página',
      description: 'Descrição resumida do conteúdo.',
      imageUrl: 'https://www.exemplo.com/imagens/capa.png',
      siteName: 'Exemplo',
      domain: 'exemplo.com',
    });
  });

  it('falls back to the title tag and description meta', () => {
    const html = `
      <head>
        <title>Somente o título</title>
        <meta name="description" content="Meta description" />
      </head>
    `;

    expect(parseLinkPreviewHtml(html, 'https://exemplo.com')).toEqual({
      title: 'Somente o título',
      description: 'Meta description',
      imageUrl: null,
      siteName: null,
      domain: 'exemplo.com',
    });
  });

  it('accepts previews without image or description', () => {
    const html = '<meta property="og:title" content="Apenas título" />';

    expect(parseLinkPreviewHtml(html, 'https://exemplo.com')).toEqual({
      title: 'Apenas título',
      description: null,
      imageUrl: null,
      siteName: null,
      domain: 'exemplo.com',
    });
  });

  it('returns null when the page has no usable metadata', () => {
    expect(
      parseLinkPreviewHtml('<html><body>Sem metadados</body></html>', 'https://exemplo.com'),
    ).toBeNull();
  });

  it('ignores unsafe image protocols', () => {
    const html = `
      <meta property="og:title" content="Título" />
      <meta property="og:image" content="javascript:alert(1)" />
    `;

    expect(parseLinkPreviewHtml(html, 'https://exemplo.com')?.imageUrl).toBeNull();
  });

  it('sanitizes tags and entities in text metadata', () => {
    const html = `
      <title>Olá &amp; <b>mundo</b></title>
      <meta property="og:description" content="  Linha   com&#10;quebras  " />
    `;

    const preview = parseLinkPreviewHtml(html, 'https://exemplo.com');

    expect(preview?.title).toBe('Olá & mundo');
    expect(preview?.description).toBe('Linha com quebras');
  });
});
