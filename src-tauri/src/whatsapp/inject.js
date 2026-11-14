// Runs inside the WhatsApp Web window. It has no access to the app: it reports back only by
// setting the page title to "__VI__" followed by JSON, which the app watches for.
(() => {
  if (window.__vi) return;

  // The address this page was opened with. WhatsApp rewrites it to "/" once it has loaded.
  const openedWith = new URL(location.href);
  const POLL_MS = 500;
  const OPEN_CHAT_LIMIT_MS = 60000;
  const CONFIRM_LIMIT_MS = 30000;

  // Keeps the page from being frozen while the window is in the background.
  try {
    navigator.locks?.request("vehicle-inspection-keepalive", () => new Promise(() => {}));
  } catch {}

  function report(payload) {
    document.title = "__VI__" + JSON.stringify(payload);
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const flat = (text) => (text || "").replace(/\s+/g, " ").trim();

  function state() {
    if (document.querySelector("#pane-side, #side")) return "ready";
    if (document.querySelector("[data-ref], canvas[aria-label]")) return "qr";
    return "loading";
  }

  function composer() {
    return (
      document.querySelector('#main footer [contenteditable="true"]') ||
      document.querySelector('#main [contenteditable="true"][role="textbox"]')
    );
  }

  // WhatsApp shows a dialog when the number from the link is not on WhatsApp.
  function invalidNumberDialog() {
    const dialog = document.querySelector('[data-animate-modal-popup="true"], [role="dialog"]');
    return dialog && /url/i.test(dialog.textContent || "") ? dialog : null;
  }

  function sendButton() {
    const icon = document.querySelector(
      '#main footer [data-icon="send"], #main footer [data-icon="wds-ic-send-filled"]',
    );
    if (icon) return icon.closest("button") || icon;
    return [...document.querySelectorAll("#main footer button[aria-label]")].find((button) =>
      /^(send|trimite|trimiteți)$/i.test(button.getAttribute("aria-label")),
    );
  }

  function lastOutgoing() {
    const all = document.querySelectorAll("#main .message-out");
    return all[all.length - 1] || null;
  }

  function messageState(message) {
    if (message.querySelector('[data-icon="msg-time"]')) return "pending";
    if (message.querySelector('[data-icon^="msg-check"], [data-icon^="msg-dblcheck"]')) return "sent";
    return "unknown";
  }

  let job = null;

  async function send(token, phone, text) {
    // Only ever press Send on the chat this page was opened for, holding exactly our text.
    if (openedWith.searchParams.get("phone") !== phone) return;
    if (job === token) return;
    job = token;
    const expected = flat(text);
    const finish = (result) => report({ token, kind: "send", result });

    const openedAt = Date.now();
    let box = null;
    while (Date.now() - openedAt < OPEN_CHAT_LIMIT_MS) {
      if (state() === "qr") return finish("not_ready");
      if (invalidNumberDialog()) return finish("invalid");
      box = composer();
      if (box && flat(box.textContent) === expected && sendButton()) break;
      box = null;
      await wait(POLL_MS);
    }
    if (!box) return finish("timeout");

    const before = lastOutgoing();
    const button = sendButton();
    button.click();
    // Give WhatsApp time to clear the box, so the fallback below never sends twice.
    await wait(1500);
    if (flat(composer()?.textContent)) {
      // Some versions only react to Enter in the text box.
      box.focus();
      box.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }),
      );
    }

    const sentAt = Date.now();
    while (Date.now() - sentAt < CONFIRM_LIMIT_MS) {
      const message = lastOutgoing();
      if (message && message !== before && flat(message.textContent).includes(expected.slice(0, 40))) {
        if (messageState(message) === "sent") return finish("sent");
      }
      await wait(POLL_MS);
    }
    const message = lastOutgoing();
    // A clock icon means WhatsApp has queued it and will send it when it can.
    if (message && message !== before && flat(message.textContent).includes(expected.slice(0, 40))) {
      return finish(messageState(message) === "pending" ? "queued" : "sent");
    }
    finish("timeout");
  }

  window.__vi = {
    probe: (token) => report({ token, kind: "status", state: state() }),
    send,
  };
})();
