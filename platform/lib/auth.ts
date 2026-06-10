// Schlanke Session-Auth ohne externe Lib: signiertes Cookie (HMAC-SHA256).
// Edge-tauglich (nur Web Crypto), damit es auch in der Middleware laeuft.
export const SESSION_COOKIE = 'kiosk_session';

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(data: string): Promise<string> {
  const secret = process.env.SESSION_SECRET || 'dev-insecure-secret';
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return b64url(new Uint8Array(sig));
}

export async function signToken(ttlSeconds = 60 * 60 * 24 * 7): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify({ exp: Date.now() + ttlSeconds * 1000 })));
  return `${payload}.${await hmac(payload)}`;
}

export async function verifyToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  if ((await hmac(payload)) !== sig) return false;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const data = JSON.parse(json);
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}
