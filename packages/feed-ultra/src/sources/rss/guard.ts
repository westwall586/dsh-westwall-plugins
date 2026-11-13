import { lookup as dnsCallback } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { SourceFetchError } from '../types.ts';

/**
 * Hosts we never dial from the preview path. The daily pool may still fetch a
 * private feed URL the user explicitly subscribed, but a one-off preview must
 * not turn the host into a proxy for the local network.
 */
const BLOCKED = new BlockList();
BLOCKED.addSubnet('0.0.0.0', 8, 'ipv4');
BLOCKED.addSubnet('10.0.0.0', 8, 'ipv4');
BLOCKED.addSubnet('100.64.0.0', 10, 'ipv4');
BLOCKED.addSubnet('127.0.0.0', 8, 'ipv4');
BLOCKED.addSubnet('169.254.0.0', 16, 'ipv4');
BLOCKED.addSubnet('172.16.0.0', 12, 'ipv4');
BLOCKED.addSubnet('192.0.0.0', 24, 'ipv4');
BLOCKED.addSubnet('192.0.2.0', 24, 'ipv4');
BLOCKED.addSubnet('192.168.0.0', 16, 'ipv4');
BLOCKED.addSubnet('198.18.0.0', 15, 'ipv4');
BLOCKED.addSubnet('198.51.100.0', 24, 'ipv4');
BLOCKED.addSubnet('203.0.113.0', 24, 'ipv4');
BLOCKED.addSubnet('224.0.0.0', 4, 'ipv4');
BLOCKED.addSubnet('240.0.0.0', 4, 'ipv4');
BLOCKED.addSubnet('::', 128, 'ipv6');
BLOCKED.addSubnet('::1', 128, 'ipv6');
BLOCKED.addSubnet('fc00::', 7, 'ipv6');
BLOCKED.addSubnet('fe80::', 10, 'ipv6');
BLOCKED.addSubnet('ff00::', 8, 'ipv6');

export interface GuardAddress {
  address: string;
  family: number;
}

export interface UrlGuardOptions {
  lookup?: (host: string) => Promise<readonly GuardAddress[]>;
}

function blockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal');
}

export function isBlockedAddress(address: string): boolean {
  return blockedAddress(address);
}

function blockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  // Every IPv4-mapped address, including public ones, is refused.
  if (family === 6 && address.toLowerCase().startsWith('::ffff:')) return true;
  return BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function invalid(url: string, reason: string): SourceFetchError {
  return new SourceFetchError('drift', `blocked URL ${url}: ${reason}`);
}

/**
 * Validates a URL before a preview fetch. DNS rebinding is not fully defeated:
 * the check resolves the name, then `fetch` resolves it again. The literal and
 * redirect checks below block the common cases; full pinning is iteration six.
 */
export async function assertPublicHttpUrl(raw: string, options: UrlGuardOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid(raw, 'not an absolute URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalid(raw, 'only http and https are allowed');
  }
  if (url.username !== '' || url.password !== '') {
    throw invalid(raw, 'credentials are not allowed');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (hostname === '' || blockedHost(hostname)) {
    throw invalid(raw, 'host is local');
  }
  if (/^\d+(?:\.\d+){0,3}$/.test(hostname) && isIP(hostname) === 0) {
    throw invalid(raw, 'non-canonical IPv4 address');
  }
  if (isIP(hostname) !== 0) {
    if (blockedAddress(hostname)) throw invalid(raw, 'address is private or reserved');
    return url;
  }

  let addresses: readonly GuardAddress[];
  try {
    addresses = await (options.lookup ?? (host => dnsLookup(host, { all: true, verbatim: true })))(hostname);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SourceFetchError('network', `cannot resolve ${hostname}: ${message}`);
  }
  if (addresses.length === 0) throw new SourceFetchError('network', `cannot resolve ${hostname}`);
  for (const entry of addresses) {
    if (blockedAddress(entry.address)) throw invalid(raw, `address ${entry.address} is private or reserved`);
  }
  return url;
}


export type AddressResolver = (host: string) => Promise<readonly GuardAddress[]>;

export type PinnedLookup = (
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (error: NodeJS.ErrnoException | null, address: string | GuardAddress[], family?: number) => void,
) => void;

function resolveAll(host: string): Promise<readonly GuardAddress[]> {
  return new Promise((resolve, reject) => {
    dnsCallback(host, { all: true, verbatim: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });
}

/**
 * A `net` lookup that refuses private addresses and returns the exact address
 * the socket will connect to. This closes the resolve-then-reconnect window
 * that a plain pre-check leaves open to DNS rebinding.
 */
export function createPinnedLookup(resolve: AddressResolver = resolveAll): PinnedLookup {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          callback(new Error(`cannot resolve ${hostname}`), '', 0);
          return;
        }
        for (const entry of addresses) {
          if (blockedAddress(entry.address)) {
            callback(new Error(`blocked address ${entry.address}`), '', 0);
            return;
          }
        }
        if (options?.all === true) {
          callback(null, [...addresses], 0);
          return;
        }
        callback(null, addresses[0].address, addresses[0].family);
      },
      (error: unknown) => {
        callback(error instanceof Error ? (error as NodeJS.ErrnoException) : new Error(String(error)), '', 0);
      },
    );
  };
}
