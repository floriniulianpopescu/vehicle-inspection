/**
 * Checks for Romanian plates and phone numbers. They only warn: a car or client that does not
 * match (a foreign plate, an army plate, a number from abroad) can still be saved.
 */

const COUNTIES = [
  "AB", "AG", "AR", "BC", "BH", "BN", "BR", "BT", "BV", "BZ", "CJ", "CL", "CS", "CT", "CV", "DB",
  "DJ", "GJ", "GL", "GR", "HD", "HR", "IF", "IL", "IS", "MH", "MM", "MS", "NT", "OT", "PH", "SB",
  "SJ", "SM", "SV", "TL", "TM", "TR", "VL", "VN", "VS",
];

/** The plate as the app stores it: capitals, no spaces or dashes. */
export function compactPlate(plate: string): string {
  return plate.toUpperCase().replace(/[\s-]/g, "");
}

/**
 * B 12 ABC or B 123 ABC in Bucharest, CJ 12 ABC elsewhere, or a temporary plate (county and
 * six digits, e.g. B 012345).
 */
export function isRomanianPlate(plate: string): boolean {
  const compact = compactPlate(plate);
  if (/^B\d{2,3}[A-Z]{3}$/.test(compact)) return true;
  const match = compact.match(/^([A-Z]{1,2})(\d{2}[A-Z]{3}|\d{6})$/);
  return match !== null && (match[1] === "B" || COUNTIES.includes(match[1]));
}

/** The number as the app stores it: "+40 722-123 456" becomes "0722123456". */
export function nationalPhone(phone: string): string {
  const compact = phone.replace(/[\s\-.()/]/g, "");
  if (compact.startsWith("+40")) return `0${compact.slice(3)}`;
  if (compact.startsWith("0040")) return `0${compact.slice(4)}`;
  return compact;
}

/** A ten-digit Romanian number shown as "0722 123 456"; anything else is left as written. */
export function formatPhone(phone: string): string {
  const national = nationalPhone(phone);
  if (!/^0\d{9}$/.test(national)) return phone;
  return `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`;
}

/** Several numbers in one text, "0722123456, 0733123456", each shown as above. */
export function formatPhones(phones: string): string {
  return phones
    .split(",")
    .map((phone) => formatPhone(phone.trim()))
    .join(", ");
}

/**
 * Spaces a number while it is typed: "0722123" becomes "0722 123". Only plain numbers
 * starting with 0 are touched, so searching by other text still works.
 */
export function typingPhone(text: string): string {
  if (!/^0[\d\s]*$/.test(text)) return text;
  const digits = text.replace(/\s/g, "");
  const groups = [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7)].filter(Boolean);
  // Keep a space the person just typed after a full group.
  const spaced = groups.join(" ");
  return text.endsWith(" ") && (digits.length === 4 || digits.length === 7) ? `${spaced} ` : spaced;
}

/** A Romanian mobile (07…) or landline (02…, 03…) number: ten digits. */
export function isRomanianPhone(phone: string): boolean {
  return /^0[237]\d{8}$/.test(nationalPhone(phone));
}
