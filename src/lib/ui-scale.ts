// Text, buttons and spacing are all sized in rem, so changing the root font size scales the whole UI.
export const UI_SCALES = [0.9, 1, 1.1, 1.25, 1.4] as const;

const STORAGE_KEY = "ui-scale";

export function loadUiScale(): number {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return (UI_SCALES as readonly number[]).includes(stored) ? stored : 1;
  } catch {
    return 1;
  }
}

export function applyUiScale(scale: number) {
  document.documentElement.style.fontSize = `${scale * 100}%`;
}

export function saveUiScale(scale: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(scale));
  } catch {
    // The scale still applies for this session.
  }
  applyUiScale(scale);
}
