import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  assertPublicIp,
  fetchHtmlDocument,
  resolvePublicAddresses,
} from '../../../src/modules/link-previews/safe-http.js';

describe('SSRF protection', () => {
  it('rejects loopback, private and reserved IPv4 ranges', () => {
    const blocked = [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.10',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ];

    for (const address of blocked) {
      expect(() => assertPublicIp(address), address).toThrow();
    }
  });

  it('rejects loopback, link-local, unique-local and mapped private IPv6', () => {
    const blocked = ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1'];

    for (const address of blocked) {
      expect(() => assertPublicIp(address), address).toThrow();
    }
  });

  it('accepts public addresses', () => {
    expect(() => assertPublicIp('8.8.8.8')).not.toThrow();
    expect(() => assertPublicIp('1.1.1.1')).not.toThrow();
    expect(() => assertPublicIp('2606:4700:4700::1111')).not.toThrow();
  });

  it('rejects localhost, metadata hosts, unsupported protocols and ports', async () => {
    await expect(resolvePublicAddresses(new URL('http://localhost/'))).rejects.toThrow();
    await expect(
      resolvePublicAddresses(new URL('http://metadata.google.internal/')),
    ).rejects.toThrow();
    await expect(resolvePublicAddresses(new URL('ftp://exemplo.com/'))).rejects.toThrow();
    await expect(resolvePublicAddresses(new URL('http://8.8.8.8:8080/'))).rejects.toThrow();
    await expect(
      resolvePublicAddresses(new URL('http://169.254.169.254/latest/meta-data')),
    ).rejects.toThrow();
    await expect(resolvePublicAddresses(new URL('http://192.168.0.1/'))).rejects.toThrow();
  });
});

describe('redirect protection', () => {
  let server: http.Server;
  let origin: string;

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      if (request.url === '/redirect-metadata') {
        response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<title>Página</title>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    origin = `http://preview.test:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('rejects a redirect that points to a blocked address', async () => {
    await expect(
      fetchHtmlDocument(`${origin}/redirect-metadata`, {
        timeoutMs: 1000,
        maxBytes: 4096,
        resolveAddresses: async (url) => {
          if (url.hostname === 'preview.test') {
            return [{ address: '127.0.0.1', family: 4 }];
          }
          return resolvePublicAddresses(url);
        },
      }),
    ).rejects.toThrow();
  });
});
