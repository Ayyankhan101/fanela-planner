import { hash, verify } from "@node-rs/argon2";

// @node-rs/argon2 defaults to Argon2id — ambient const-enum Algorithm is
// incompatible with isolatedModules, so rely on the default.
const OPTS = {
  memoryCost: 19_456, // 19 MiB — OWASP 2024 minimum
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTS);
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain);
  } catch {
    return false;
  }
}
