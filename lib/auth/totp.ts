import { TOTP, Secret } from "otpauth";

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function verifyTotp(secretBase32: string, token: string): boolean {
  const totp = new TOTP({
    label: "Fanela",
    issuer: "Fanela",
    secret: secretBase32,
    digits: 6,
    period: 30,
  });
  return totp.validate({ token, window: 1 }) !== null;
}

// current 6-digit code (tests / seed verification)
export function currentTotp(secretBase32: string): string {
  const totp = new TOTP({
    label: "Fanela",
    issuer: "Fanela",
    secret: secretBase32,
    digits: 6,
    period: 30,
  });
  return totp.generate();
}

export function totpUri(secretBase32: string, accountName: string): string {
  const totp = new TOTP({
    label: `Fanela:${accountName}`,
    issuer: "Fanela",
    secret: secretBase32,
    digits: 6,
    period: 30,
  });
  return totp.toString();
}
