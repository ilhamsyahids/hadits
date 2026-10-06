// The admin page's sign-in: ADMIN_USER and ADMIN_PASSWORD (secrets), and a cookie holding an expiry signed with
// HMAC-SHA256. The key comes from both secrets, so changing either one signs everyone out.
type AdminSecrets = { ADMIN_USER?: string; ADMIN_PASSWORD?: string };

export const ADMIN_COOKIE = 'admin_session';
const SESSION_SECONDS = 60 * 60 * 12;
const enc = new TextEncoder();

export const adminEnabled = (env: AdminSecrets) => Boolean(env.ADMIN_USER && env.ADMIN_PASSWORD);

/** Compares two secrets in constant time (both are hashed first, so their lengths do not leak). */
export async function sameSecret(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

export async function checkLogin(env: AdminSecrets, user: string, password: string): Promise<boolean> {
  if (!adminEnabled(env)) return false;
  const [u, p] = await Promise.all([sameSecret(user, env.ADMIN_USER!), sameSecret(password, env.ADMIN_PASSWORD!)]);
  return u && p;
}

async function sign(env: AdminSecrets, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(`${env.ADMIN_USER}\0${env.ADMIN_PASSWORD}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Set-Cookie value for a new session. */
export async function sessionCookie(env: AdminSecrets, secure: boolean): Promise<string> {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  return `${ADMIN_COOKIE}=${exp}.${await sign(env, exp)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export const clearedCookie = (secure: boolean) => `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;

export async function hasSession(env: AdminSecrets, cookieHeader: string | null | undefined): Promise<boolean> {
  if (!adminEnabled(env) || !cookieHeader) return false;
  const value = cookieHeader.split(/;\s*/).find((c) => c.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length + 1) ?? '';
  const [exp, mac] = value.split('.');
  if (!exp || !mac || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  return sameSecret(mac, await sign(env, exp));
}
