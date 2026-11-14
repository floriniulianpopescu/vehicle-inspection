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

/** A Romanian mobile (07…) or landline (02…, 03…) number: ten digits. */
export function isRomanianPhone(phone: string): boolean {
  return /^0[237]\d{8}$/.test(nationalPhone(phone));
}
