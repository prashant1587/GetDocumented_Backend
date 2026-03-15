import crypto from 'node:crypto';

import { env } from '../config/env.js';

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

const toBase64Url = (value) => Buffer.from(value).toString('base64url');
const fromBase64Url = (value) => Buffer.from(value, 'base64url').toString('utf8');

export const hashPassword = async (password) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(password, env.AUTH_TOKEN_SECRET, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey.toString('hex'));
    });
  });

export const verifyPassword = async (password, passwordHash) => {
  const candidateHash = await hashPassword(password);
  return crypto.timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(passwordHash, 'hex'));
};

const signPayload = (payload) =>
  crypto.createHmac('sha256', env.AUTH_TOKEN_SECRET).update(payload).digest('base64url');

export const createAuthToken = (user) => {
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
};

export const verifyAuthToken = (token) => {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const [encodedPayload, signature] = token.split('.');

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload));

    if (!payload?.sub || !payload?.email || !payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
};
