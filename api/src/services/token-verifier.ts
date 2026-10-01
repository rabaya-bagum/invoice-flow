import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Config } from '../config';
import { AppError } from '../utils/errors';

export interface AuthUser {
  id: string;
  email?: string;
}

export type TokenVerifier = (token: string) => Promise<AuthUser>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Options {
  issuer: string;
  audience?: string;
  /** A key resolver (JWKS) or a shared secret (legacy HS256 projects). */
  key: JWTVerifyGetKey | Uint8Array;
  algorithms: string[];
}

/** Verifies a Supabase access token: signature, expiry, issuer, audience, and a UUID subject. */
export function createTokenVerifier(opts: Options): TokenVerifier {
  const { issuer, audience = 'authenticated', key, algorithms } = opts;
  return async (token) => {
    try {
      const verifyOpts = { issuer, audience, algorithms };
      const { payload } =
        typeof key === 'function'
          ? await jwtVerify(token, key, verifyOpts)
          : await jwtVerify(token, key, verifyOpts);
      if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) {
        throw new Error('invalid subject');
      }
      return {
        id: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
      };
    } catch {
      // Deliberately vague: do not tell callers why verification failed.
      throw new AppError(401, 'UNAUTHENTICATED', 'Session expired or invalid');
    }
  };
}

export function tokenVerifierFromConfig(config: Config): TokenVerifier {
  if (!config.SUPABASE_URL) throw new Error('SUPABASE_URL is required to verify tokens');
  const issuer = `${config.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
  if (config.SUPABASE_JWT_SECRET) {
    return createTokenVerifier({
      issuer,
      key: new TextEncoder().encode(config.SUPABASE_JWT_SECRET),
      algorithms: ['HS256'],
    });
  }
  return createTokenVerifier({
    issuer,
    key: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)),
    algorithms: ['ES256', 'RS256'],
  });
}
