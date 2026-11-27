/** Invoice numbers are sequential per shop and shown as INV-000123. */
export function formatInvoiceNumber(invoiceNo: number): string {
  return `INV-${String(invoiceNo).padStart(6, '0')}`;
}

/** Accepts "INV-000123", "inv-123", "000123" or "123". Returns null if it is not one. */
export function parseInvoiceNumber(input: string): number | null {
  const match = /^(?:inv-?)?0*(\d{1,9})$/i.exec(input.trim());
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return n >= 1 ? n : null;
}
