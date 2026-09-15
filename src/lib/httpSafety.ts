import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Outbound HTTP safety helpers.
 *
 * Crawler URLs are user controlled. URL syntax checks alone do not prevent
 * requests to cloud metadata endpoints or private services, because a public
 * hostname can resolve to a private address and redirects can change hosts.
 */

const BLOCKED_HOST_SUFFIXES = [".internal", ".localhost", ".local", ".home", ".lan"];
const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.azure.internal",
  "instance-data",
]);

function ipv4Number(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

function inCidr4(value: number, base: number, bits: number): boolean {
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
}

/** true only for globally routable addresses suitable for user-directed fetches. */
export function isPublicIpAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase().split("%")[0];
  const family = isIP(normalized);

  if (family === 4) {
    const value = ipv4Number(normalized);
    if (value === null) return false;

    // Non-global, private, loopback, link-local, benchmarking, documentation,
    // multicast and reserved IPv4 ranges.
    const blocked: Array<[string, number]> = [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ];
    return !blocked.some(([base, bits]) => inCidr4(value, ipv4Number(base)!, bits));
  }

  if (family === 6) {
    // IPv4-mapped IPv6. Node generally normalizes these as ::ffff:a.b.c.d.
    const mapped = normalized.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
    if (mapped) return isPublicIpAddress(mapped);

    if (normalized === "::" || normalized === "::1") return false;
    if (/^f[cd]/.test(normalized)) return false; // unique-local fc00::/7
    if (/^fe[89ab]/.test(normalized)) return false; // link-local fe80::/10
    if (normalized.startsWith("ff")) return false; // multicast ff00::/8
    if (normalized.startsWith("2001:db8")) return false; // documentation
    if (normalized.startsWith("2001:2:")) return false; // benchmarking
    return true;
  }

  return false;
}

export interface OutboundUrlOptions {
  /** Optional production allowlist. Entries allow the host and its subdomains. */
  allowedHosts?: readonly string[];
  allowedPorts?: readonly string[];
}

function hostMatchesAllowlist(hostname: string, allowedHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return allowedHosts.some((entry) => {
    const allowed = entry.trim().toLowerCase().replace(/^\./, "").replace(/\.$/, "");
    return Boolean(allowed) && (host === allowed || host.endsWith(`.${allowed}`));
  });
}

/**
 * Synchronous checks performed before DNS. Exported for route validation/tests.
 * Returns the parsed URL so callers do not parse it differently later.
 */
export function validateOutboundUrlSyntax(
  rawUrl: string,
  options: OutboundUrlOptions = {}
): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Geçerli bir URL girin.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Yalnızca http/https URL'leri kullanılabilir.");
  }
  if (url.username || url.password) {
    throw new Error("Kullanıcı bilgisi içeren URL'ler güvenlik nedeniyle kullanılamaz.");
  }

  const allowedPorts = options.allowedPorts ?? ["", "80", "443"];
  if (!allowedPorts.includes(url.port)) {
    throw new Error("Yalnızca standart web portları (80/443) kullanılabilir.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname ||
    BLOCKED_HOSTS.has(hostname) ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error("Bu host güvenlik politikası gereği kullanılamaz.");
  }

  if (isIP(hostname) && !isPublicIpAddress(hostname)) {
    throw new Error("Özel veya ayrılmış ağ adreslerine erişim engellendi.");
  }

  if (options.allowedHosts?.length && !hostMatchesAllowlist(hostname, options.allowedHosts)) {
    throw new Error("Bu alan adı crawler izin listesinde değil.");
  }

  return url;
}

/**
 * DNS rebinding/private-network guard. Mixed public/private DNS answers are
 * rejected rather than choosing the public answer.
 */
export async function assertSafeOutboundUrl(
  rawUrl: string,
  options: OutboundUrlOptions = {}
): Promise<URL> {
  const url = validateOutboundUrlSyntax(rawUrl, options);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");

  if (isIP(hostname)) return url;

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Alan adı çözümlenemedi.");
  }

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error("Alan adı özel veya ayrılmış bir ağ adresine çözümleniyor; istek engellendi.");
  }

  return url;
}

/** Read an HTTP response without trusting Content-Length. */
export async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Yanıt boyutu izin verilen ${Math.ceil(maxBytes / 1024 / 1024)} MB sınırını aşıyor.`);
  }

  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel("response too large");
        throw new Error(`Yanıt boyutu izin verilen ${Math.ceil(maxBytes / 1024 / 1024)} MB sınırını aşıyor.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number
): Promise<string> {
  return new TextDecoder().decode(await readResponseBytesWithLimit(response, maxBytes));
}
