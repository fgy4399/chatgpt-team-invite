import crypto from "crypto";

// Generate a secure random invite code
export function generateInviteCode(): string {
  const bytes = crypto.randomBytes(12);
  return bytes.toString("base64url").slice(0, 16);
}

// Validate invite code format
export function isValidCodeFormat(code: string): boolean {
  return /^[A-Za-z0-9_-]{8,20}$/.test(code);
}

// Validate email format
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
