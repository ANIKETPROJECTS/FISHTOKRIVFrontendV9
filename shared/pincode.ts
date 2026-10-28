export function normalizePincode(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function isValidIndianPincode(value: unknown): boolean {
  return /^[1-9]\d{5}$/.test(normalizePincode(value));
}
