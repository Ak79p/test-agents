import type { CardDetails } from '../api/types';

export interface CardForm {
  holderName: string;
  number: string;
  expiry: string; // MM/YY
  cvc: string;
}

export type CardErrors = Partial<Record<keyof CardForm, string>>;

export const TEST_CARDS = [
  { number: '4242 4242 4242 4242', outcome: 'Success' },
  { number: '5555 5555 5555 4444', outcome: 'Success (Mastercard)' },
  { number: '4000 0000 0000 0002', outcome: 'Declined' },
  { number: '4000 0000 0000 9995', outcome: 'Insufficient funds' },
  { number: '4000 0000 0000 0069', outcome: 'Expired card' },
  { number: '4000 0000 0000 0119', outcome: 'Gateway error (retryable)' },
  { number: '4000 0000 0000 1018', outcome: 'Gateway timeout → fails later' },
  { number: '4000 0000 0000 2024', outcome: 'Pending → succeeds later' },
  { number: '4000 0000 0000 3030', outcome: 'Pending → declined later' },
];

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function formatCardNumber(value: string): string {
  return digitsOnly(value)
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function formatExpiry(value: string): string {
  const d = digitsOnly(value).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

export function validateCard(form: CardForm, now = new Date()): CardErrors {
  const errors: CardErrors = {};
  if (form.holderName.trim().length < 2) errors.holderName = 'Enter the name on the card.';

  const digits = digitsOnly(form.number);
  if (!digits) errors.number = 'Enter a card number.';
  else if (digits.length < 12 || digits.length > 19) errors.number = 'Card number must be 12 to 19 digits.';
  else if (!luhnValid(digits)) errors.number = 'Card number is invalid.';

  const match = /^(\d{2})\/(\d{2})$/.exec(form.expiry);
  if (!match) errors.expiry = 'Enter expiry as MM/YY.';
  else {
    const month = Number(match[1]);
    const year = 2000 + Number(match[2]);
    if (month < 1 || month > 12) errors.expiry = 'Expiry month must be 01–12.';
    else if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1))
      errors.expiry = 'Card has expired.';
  }

  if (!/^\d{3,4}$/.test(form.cvc)) errors.cvc = 'CVC must be 3 or 4 digits.';
  return errors;
}

export function toCardDetails(form: CardForm): CardDetails {
  const [mm, yy] = form.expiry.split('/');
  return {
    number: digitsOnly(form.number),
    expiry_month: Number(mm),
    expiry_year: 2000 + Number(yy),
    cvc: form.cvc,
    holder_name: form.holderName.trim(),
  };
}

/** Maps backend validation field paths onto the form's fields. */
export function mapServerCardErrors(fieldErrors: Record<string, string>): CardErrors {
  const errors: CardErrors = {};
  for (const [field, message] of Object.entries(fieldErrors)) {
    if (field === 'card.number') errors.number = message;
    else if (field === 'card.cvc') errors.cvc = message;
    else if (field === 'card.holder_name') errors.holderName = message;
    else if (field.startsWith('card.expiry') || field === 'card') errors.expiry = message;
  }
  return errors;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `key-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
