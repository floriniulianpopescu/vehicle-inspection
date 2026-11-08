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

/** Sends one SMS every 30 seconds, so the first goes out immediately. */
export function sendingMinutes(count: number): number {
  return Math.ceil(((count - 1) * 30) / 60);
}
