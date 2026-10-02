import { createHash, randomBytes } from "node:crypto";
import { RECOVERY_CODE_COUNT } from "./mfa";

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// 8 codes like A1B2C-D3E4F — shown once, stored as sha256 hashes
export function generateRecoveryCodes(): { codes: string[]; stored: string } {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, stored: JSON.stringify(codes.map(sha256)) };
}

// returns remaining hashes when code matches (single use), else null
export function matchRecoveryCode(stored: string | null, code: string): string | null {
  if (!stored) return null;
  let list: string[];
  try {
    list = JSON.parse(stored);
  } catch {
    return null;
  }
  const h = sha256(code.trim().toUpperCase());
  const idx = list.indexOf(h);
  if (idx === -1) return null;
  list.splice(idx, 1);
  return JSON.stringify(list);
}
