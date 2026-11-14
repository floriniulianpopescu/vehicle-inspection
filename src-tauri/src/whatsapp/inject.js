// Runs inside the WhatsApp Web window. It has no access to the app: it reports back only by
// setting the page title to "__VI__" followed by JSON, which the app watches for.
//
// WhatsApp changes its page often, so this relies on as little of it as possible: the message
// box is the editable field holding exactly our text, and the Send button is found next to it.
(() => {
  if (window.__vi) return;

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
  const flat = (text) => (text || "").replace(/[\s​‎‏﻿]+/g, " ").trim();

  function state() {
    if (document.querySelector("#pane-side, #side, [data-testid='chat-list']")) return "ready";
    if (document.querySelector("[data-ref], canvas[aria-label]")) return "qr";
    return "loading";
  }

  function editables() {
    return [...document.querySelectorAll('[contenteditable="true"]')];
  }

  /** The message box: the editable field that holds exactly our text. */
  function composerWith(expected) {
    return editables().find((field) => flat(field.textContent) === expected) || null;
  }

  // WhatsApp shows a dialog when the number from the link is not on WhatsApp.
  function invalidNumberDialog() {
    const dialog = document.querySelector('[data-animate-modal-popup="true"], [role="dialog"]');
    return dialog && /url/i.test(dialog.textContent || "") ? dialog : null;
  }

  const SEND_LABEL = /^(send|trimite|trimiteți|trimiteti)$/i;

  /** The Send button closest to the message box. */
  function sendButtonNear(box) {
    let scope = box;
    for (let level = 0; level < 8 && scope; level += 1) {
      scope = scope.parentElement;
      if (!scope) break;
      const icon = scope.querySelector('[data-icon*="send"]');
      if (icon) return icon.closest('button, [role="button"]') || icon;
      const labelled = [...scope.querySelectorAll('button[aria-label], [role="button"][aria-label]')].find(
        (button) => SEND_LABEL.test(flat(button.getAttribute("aria-label"))),
      );
      if (labelled) return labelled;
    }
    return null;
  }

  function pressEnter(box) {
    box.focus();
    for (const type of ["keydown", "keypress", "keyup"]) {
      box.dispatchEvent(
        new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }),
      );
    }
  }

  /**
   * The open chat: WhatsApp's "#main" panel, or else a wide ancestor of the message box. The
   * chat list on the side is left out, because it previews the same greeting for other clients.
   */
  function chatPanel(box) {
    const main = document.querySelector("#main");
    if (main) return main;
    const chatList = document.querySelector(
      "#pane-side, #side, [data-testid='chat-list'], [aria-label*='Chat list' i], [aria-label*='conversații' i]",
    );
    let panel = box;
    for (let level = 0; level < 8 && panel.parentElement; level += 1) {
      const parent = panel.parentElement;
      // Widen up to, but never including, the part that holds the chat list.
      if (parent === document.body || (chatList && parent.contains(chatList))) break;
      panel = parent;
    }
    return panel;
  }

  /** The newest element in the chat, outside any editable field, that shows our text. */
  function shownMessage(panel, snippet) {
    const fields = editables();
    const candidates = [...panel.querySelectorAll("span, div")].filter(
      (element) =>
        element.childElementCount === 0 &&
        flat(element.textContent).includes(snippet) &&
        !fields.some((field) => field.contains(element)),
    );
    return candidates[candidates.length - 1] || null;
  }

  /** "sent" once WhatsApp shows a tick next to the message, "pending" while it shows a clock. */
  function tickState(message) {
    let row = message;
    for (let level = 0; level < 10 && row; level += 1) {
      row = row.parentElement;
      if (!row) break;
      if (row.querySelector('[data-icon*="check"]')) return "sent";
      if (row.querySelector('[data-icon*="msg-time"], [data-icon*="clock"]')) return "pending";
    }
    return "unknown";
  }

  let job = null;
  // Set when staff press Stop. Before Send is pressed the message is dropped; after, it is
  // only confirmed quickly.
  let cancelled = null;
  // The picture for the next send, handed over separately because it is large.
  let stashed = null;

  /** Every Send control on the page: icons named "send" and buttons labelled Send. */
  function sendControls() {
    const icons = [...document.querySelectorAll('[data-icon*="send"]')].map(
      (icon) => icon.closest('button, [role="button"]') || icon,
    );
    const labelled = [...document.querySelectorAll('button[aria-label], [role="button"][aria-label]')].filter(
      (button) => SEND_LABEL.test(flat(button.getAttribute("aria-label"))),
    );
    return [...new Set([...icons, ...labelled])];
  }

  async function waitFor(check, limitMs) {
    const started = Date.now();
    while (Date.now() - started < limitMs) {
      const found = check();
      if (found) return found;
      await wait(POLL_MS);
    }
    return null;
  }

  function imageFile(picture) {
    const bytes = Uint8Array.from(atob(picture.base64), (char) => char.charCodeAt(0));
    const extension = picture.mime === "image/png" ? "png" : "jpg";
    return new File([bytes], `felicitare.${extension}`, { type: picture.mime });
  }

  /** Waits for WhatsApp's tick on the message showing `snippet`, then reports the result. */
  async function confirm(panel, snippet, stopped, finish) {
    const sentAt = Date.now();
    let last = "unknown";
    while (Date.now() - sentAt < CONFIRM_LIMIT_MS) {
      const message = shownMessage(panel, snippet);
      if (message) {
        last = tickState(message);
        if (last === "sent") return finish("sent");
        // Stopping: the message is in the chat, so WhatsApp has it.
        if (stopped()) return finish("sent_unconfirmed");
      }
      await wait(POLL_MS);
    }
    // The text is in the chat: WhatsApp has it. A clock means it is queued and goes out as
    // soon as it can.
    if (shownMessage(panel, snippet)) return finish(last === "pending" ? "queued" : "sent_unconfirmed");
    finish("timeout_after_send");
  }

  /**
   * Sends the picture with the text as its caption: pastes it into the chat (or drops it, if
   * pasting does nothing), fills in the caption if WhatsApp did not carry the text over, and
   * presses the Send button of the preview that opens.
   */
  async function sendWithImage(box, expected, text, picture, stopped, trace, finish) {
    const snippet = expected.slice(0, 40);
    const panel = chatPanel(box);
    const fieldsBefore = new Set(editables());
    const controlsBefore = new Set(sendControls());
    // The preview has a Send button and a caption field that were not there before.
    const preview = () => {
      const control = sendControls().find((candidate) => !controlsBefore.has(candidate));
      const caption = editables().find((field) => !fieldsBefore.has(field));
      return control && caption ? { control, caption } : null;
    };
    const files = () => {
      const transfer = new DataTransfer();
      transfer.items.add(imageFile(picture));
      return transfer;
    };

    trace("pasting the picture");
    box.focus();
    box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: files(), bubbles: true, cancelable: true }));
    let opened = await waitFor(preview, 8000);
    if (!opened) {
      trace("paste did nothing, dropping the picture");
      for (const type of ["dragenter", "dragover", "drop"]) {
        panel.dispatchEvent(new DragEvent(type, { dataTransfer: files(), bubbles: true, cancelable: true }));
      }
      opened = await waitFor(preview, 8000);
    }
    if (!opened) return finish("image_not_attached");
    if (stopped()) return finish("cancelled");

    if (!flat(opened.caption.textContent).includes(snippet)) {
      trace("writing the caption");
      opened.caption.focus();
      document.execCommand("insertText", false, text);
      await wait(500);
    }

    trace("pressing send on the picture");
    opened.control.click();
    await wait(1500);
    // WhatsApp may leave the original text in the message box as a draft; clear it so it is
    // never sent on its own later.
    const leftover = composerWith(expected);
    if (leftover && leftover !== opened.caption) {
      leftover.focus();
      document.execCommand("selectAll");
      document.execCommand("delete");
    }
    trace("waiting for the tick");
    return confirm(panel, snippet, stopped, finish);
  }

  async function send(token, text, navigatedAt, withImage) {
    // Only the page opened for this message may act. An older page could still be showing the
    // same greeting for the previous client.
    if (performance.timeOrigin < navigatedAt) return;
    if (job === token) return;
    job = token;
    const expected = flat(text);
    const snippet = expected.slice(0, 40);
    const trace = (stage) => report({ token, kind: "trace", stage });
    const finish = (result) => report({ token, kind: "send", result });

    const stopped = () => cancelled === token;
    const picture = withImage ? stashed : null;
    if (withImage && (!picture || picture.token !== token)) return finish("no_image");

    trace("waiting for the chat");
    const openedAt = Date.now();
    let box = null;
    while (Date.now() - openedAt < OPEN_CHAT_LIMIT_MS) {
      if (stopped()) return finish("cancelled");
      if (state() === "qr") return finish("not_ready");
      if (invalidNumberDialog()) return finish("invalid");
      box = composerWith(expected);
      if (box) break;
      await wait(POLL_MS);
    }
    if (!box) return finish("timeout_no_text");

    // Let WhatsApp finish setting up the chat before pressing anything.
    await wait(1500);
    if (stopped()) return finish("cancelled");
    box = composerWith(expected) || box;
    const panel = chatPanel(box);
    if (picture) return sendWithImage(box, expected, text, picture, stopped, trace, finish);

    const button = sendButtonNear(box);
    trace(button ? "pressing send" : "no send button, pressing enter");
    if (button) button.click();
    else pressEnter(box);

    // Give WhatsApp time to empty the box, so the fallback below never sends twice.
    await wait(1500);
    if (composerWith(expected)) {
      trace("text still there, pressing enter");
      pressEnter(composerWith(expected));
      await wait(1500);
    }
    if (composerWith(expected)) return finish("not_sent");

    trace("waiting for the tick");
    return confirm(panel, snippet, stopped, finish);
  }

  window.__vi = {
    probe: (token) => report({ token, kind: "status", state: state() }),
    cancel: (token) => {
      cancelled = token;
    },
    /** Answers once this is the page opened for the current message. */
    fresh: (token, navigatedAt) => {
      if (performance.timeOrigin >= navigatedAt) report({ token, kind: "fresh" });
    },
    stash: (token, base64, mime) => {
      stashed = { token, base64, mime };
    },
    send,
  };
})();
