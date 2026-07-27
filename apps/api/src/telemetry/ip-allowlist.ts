/**
 * Returns true when the remote address is allowed to scrape /metrics.
 * Supports exact IPs, CIDR notation, and IPv4-mapped IPv6 (::ffff:x.x.x.x).
 */
export function isIpAllowed(remoteAddress: string, allowlist: string[]): boolean {
  const ip = normalizeIp(remoteAddress);
  if (!ip) {
    return false;
  }

  for (const entry of allowlist) {
    const rule = entry.trim();
    if (!rule) continue;

    if (rule.includes('/')) {
      if (matchCidr(ip, rule)) {
        return true;
      }
      continue;
    }

    if (normalizeIp(rule) === ip) {
      return true;
    }
  }

  return false;
}

export function normalizeIp(address: string): string {
  const trimmed = address.trim().toLowerCase();
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice('::ffff:'.length);
  }
  if (trimmed === '::1') {
    return '127.0.0.1';
  }
  return trimmed;
}

function matchCidr(ip: string, cidr: string): boolean {
  const [network, bitsRaw] = cidr.split('/');
  if (!network || bitsRaw === undefined) {
    return false;
  }

  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }

  const ipNum = ipv4ToInt(normalizeIp(ip));
  const netNum = ipv4ToInt(normalizeIp(network));
  if (ipNum === null || netNum === null) {
    return false;
  }

  if (bits === 0) {
    return true;
  }

  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (ipNum & mask) === (netNum & mask);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      return null;
    }
    value = ((value << 8) + n) >>> 0;
  }
  return value;
}
