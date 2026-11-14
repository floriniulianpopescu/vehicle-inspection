const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€";

const SINGLE_GSM = 160;
const PART_GSM = 153;
const SINGLE_UNICODE = 70;
const PART_UNICODE = 67;

/** How many characters a text uses and how many SMS it is billed as. */
export function smsSize(text: string): { characters: number; parts: number } {
  const symbols = [...text];
  const isGsm = symbols.every((symbol) => GSM_BASIC.includes(symbol) || GSM_EXTENDED.includes(symbol));
  const characters = isGsm
    ? symbols.reduce((total, symbol) => total + (GSM_EXTENDED.includes(symbol) ? 2 : 1), 0)
    : text.length;
  const [single, part] = isGsm ? [SINGLE_GSM, PART_GSM] : [SINGLE_UNICODE, PART_UNICODE];
  return { characters, parts: characters <= single ? 1 : Math.ceil(characters / part) };
}

export const MIN_INTERVAL_SECONDS = 30;
export const MAX_INTERVAL_SECONDS = 3600;

/** Whole seconds between messages, kept between the minimum and maximum; null if not a number. */
export function clampInterval(text: string): number | null {
  const value = Number.parseInt(text, 10);
  if (Number.isNaN(value)) return null;
  return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, value));
}

/** The first message goes out at once, then one every `interval` seconds. */
export function sendingSeconds(count: number, interval: number): number {
  return Math.max(0, count - 1) * interval;
}

/** Seconds as hours, minutes and seconds: 3930 is { hours: 1, minutes: 5, seconds: 30 }. */
export function splitDuration(total: number): { hours: number; minutes: number; seconds: number } {
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}
