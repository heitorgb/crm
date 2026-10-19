import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

export class UnsafeUrlError extends Error {
  constructor(message = 'URL not allowed') {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export class RemoteFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoteFetchError';
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface FetchHtmlOptions {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects?: number;
  userAgent?: string;
  resolveAddresses?: (url: URL) => Promise<ResolvedAddress[]>;
}

export interface FetchHtmlResult {
  finalUrl: string;
  body: Buffer;
  contentType: string;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.intranet',
  '.lan',
  '.home.arpa',
  '.test',
  '.invalid',
  '.example',
];

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_HTML_TYPES = ['text/html', 'application/xhtml+xml'];

export async function resolvePublicAddresses(url: URL): Promise<ResolvedAddress[]> {
  assertAllowedUrl(url);

  const hostname = url.hostname.replace(/\.$/, '').toLowerCase();
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    assertPublicIp(hostname);
    return [{ address: hostname, family: literalFamily }];
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new RemoteFetchError('Host could not be resolved');
  }

  const resolved: ResolvedAddress[] = [];
  for (const record of records) {
    if (record.family !== 4 && record.family !== 6) {
      continue;
    }
    assertPublicIp(record.address);
    resolved.push({ address: record.address, family: record.family });
  }

  if (resolved.length === 0) {
    throw new RemoteFetchError('Host has no usable address');
  }

  return resolved;
}

export function assertPublicIp(address: string): void {
  const family = isIP(address);
  if (family === 4 && isBlockedIpv4(address)) {
    throw new UnsafeUrlError('Private or reserved IPv4 address');
  }
  if (family === 6 && isBlockedIpv6(address)) {
    throw new UnsafeUrlError('Private or reserved IPv6 address');
  }
  if (family === 0) {
    throw new UnsafeUrlError('Invalid IP address');
  }
}

export async function fetchHtmlDocument(
  rawUrl: string,
  options: FetchHtmlOptions,
): Promise<FetchHtmlResult> {
  const maxRedirects = options.maxRedirects ?? 3;
  let current = new URL(rawUrl);

  const resolveAddresses = options.resolveAddresses ?? resolvePublicAddresses;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const addresses = await resolveAddresses(current);
    const response = await requestOnce(current, addresses, options);

    if (REDIRECT_STATUSES.has(response.statusCode)) {
      if (redirectCount === maxRedirects) {
        throw new RemoteFetchError('Too many redirects');
      }
      const location = response.headers.location;
      if (!location) {
        throw new RemoteFetchError('Redirect without location');
      }

      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new RemoteFetchError('Invalid redirect target');
      }

      assertAllowedUrl(next);
      current = next;
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new RemoteFetchError(`Unexpected status ${response.statusCode}`);
    }

    const rawContentType = response.headers['content-type'] ?? '';
    const contentType = normalizeContentType(rawContentType);
    if (!ALLOWED_HTML_TYPES.some((type) => contentType.startsWith(type))) {
      throw new RemoteFetchError('Response is not HTML');
    }

    return {
      finalUrl: current.toString(),
      body: response.body,
      contentType: rawContentType,
    };
  }

  throw new RemoteFetchError('Too many redirects');
}

function assertAllowedUrl(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only HTTP and HTTPS are allowed');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URL credentials are not allowed');
  }
  if (url.port) {
    const port = Number(url.port);
    const expected = url.protocol === 'https:' ? 443 : 80;
    if (port !== expected) {
      throw new UnsafeUrlError('URL port is not allowed');
    }
  }

  const hostname = url.hostname.replace(/\.$/, '').toLowerCase();
  if (!hostname) {
    throw new UnsafeUrlError('URL has no hostname');
  }
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new UnsafeUrlError('Blocked hostname');
  }
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new UnsafeUrlError('Blocked hostname suffix');
  }
}

function requestOnce(
  url: URL,
  addresses: ResolvedAddress[],
  options: FetchHtmlOptions,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    let settled = false;
    const timer: { current?: NodeJS.Timeout } = {};

    const finish = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer.current) {
        clearTimeout(timer.current);
      }
      reject(error);
    };

    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : isHttps ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'accept-encoding': 'identity',
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
          'user-agent': options.userAgent ?? 'OrderUpCRM-LinkPreview/1.0 (+https://orderup.app)',
        },
        lookup: createPinnedLookup(addresses),
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const contentLength = Number(response.headers['content-length']);

        if (REDIRECT_STATUSES.has(statusCode)) {
          settled = true;
          if (timer.current) {
            clearTimeout(timer.current);
          }
          response.resume();
          resolve({ statusCode, headers: response.headers, body: Buffer.alloc(0) });
          return;
        }

        if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
          response.destroy();
          finish(new RemoteFetchError('Response is too large'));
          return;
        }

        const chunks: Buffer[] = [];
        let received = 0;

        response.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > options.maxBytes) {
            response.destroy();
            finish(new RemoteFetchError('Response is too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) {
            return;
          }
          settled = true;
          if (timer.current) {
            clearTimeout(timer.current);
          }
          resolve({
            statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
        response.on('error', (error) => finish(toError(error)));
      },
    );

    timer.current = setTimeout(() => {
      request.destroy();
      finish(new RemoteFetchError('Request timed out'));
    }, options.timeoutMs);

    request.setTimeout(options.timeoutMs, () => {
      request.destroy();
      finish(new RemoteFetchError('Request timed out'));
    });
    request.on('error', (error) => finish(toError(error)));
    request.end();
  });
}

function createPinnedLookup(
  addresses: ResolvedAddress[],
): (
  hostname: string,
  options: unknown,
  callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void,
) => void {
  return (_hostname, lookupOptions, callback) => {
    const requestedFamily =
      typeof lookupOptions === 'object' && lookupOptions !== null
        ? (lookupOptions as { family?: number }).family
        : undefined;
    const candidates =
      requestedFamily === 4 || requestedFamily === 6
        ? addresses.filter((item) => item.family === requestedFamily)
        : addresses;
    const selected = candidates[0] ?? addresses[0];

    if (!selected) {
      const error = new Error('No address available') as NodeJS.ErrnoException;
      error.code = 'ENOTFOUND';
      callback(error, '', 0);
      return;
    }

    callback(null, selected.address, selected.family);
  };
}

function normalizeContentType(value: string | undefined): string {
  return (value ?? '').split(';')[0].trim().toLowerCase();
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error('Remote request failed');
}

function isBlockedIpv4(address: string): boolean {
  const octets = address.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b, c] = octets;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];

  if (normalized === '::' || normalized === '::1') {
    return true;
  }

  const firstGroup = normalized.split(':')[0] ?? '';
  const firstValue = Number.parseInt(firstGroup, 16);
  if (!Number.isFinite(firstValue)) {
    return true;
  }

  if ((firstValue & 0xfe00) === 0xfc00) {
    return true;
  }
  if ((firstValue & 0xffc0) === 0xfe80) {
    return true;
  }
  if ((firstValue & 0xff00) === 0xff00) {
    return true;
  }
  if (firstValue === 0x2001 && normalized.startsWith('2001:db8')) {
    return true;
  }
  if (firstValue === 0x2002) {
    return true;
  }
  if (firstValue === 0x0064 && normalized.startsWith('64:ff9b')) {
    return true;
  }

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized);
  if (mapped) {
    return isBlockedIpv4(mapped[1]);
  }
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    const ipv4 = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    return isBlockedIpv4(ipv4);
  }
  if (normalized.startsWith('::ffff:')) {
    return true;
  }

  return false;
}
