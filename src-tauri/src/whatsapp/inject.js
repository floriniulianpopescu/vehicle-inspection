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
  /**
   * Text reduced to its letters and digits, for comparing what WhatsApp shows with what was
   * sent: it may swap spaces for non-breaking ones, turn emoji into pictures, split the text
   * into pieces or write ş/ţ for ș/ț, and the text is still ours.
   */
  const loose = (text) =>
    (text || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/ş/g, "ș")
      .replace(/ţ/g, "ț")
      .replace(/[^\p{L}\p{N}]+/gu, "");

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
    const wanted = loose(expected);
    return editables().find((field) => wanted !== "" && loose(field.textContent) === wanted) || null;
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

  /**
   * Presses like a mouse does: pointer and mouse down and up over the middle of the element,
   * then the click. Newer WhatsApp pages react to the pointer events, not to a bare click().
   */
  function press(element) {
    const rect = element.getBoundingClientRect();
    const at = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    const pointer = { ...at, pointerId: 1, pointerType: "mouse", isPrimary: true };
    element.dispatchEvent(new PointerEvent("pointerover", pointer));
    element.dispatchEvent(new PointerEvent("pointerenter", { ...pointer, bubbles: false }));
    element.dispatchEvent(new MouseEvent("mouseover", at));
    element.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
    element.dispatchEvent(new MouseEvent("mousedown", { ...at, buttons: 1 }));
    element.dispatchEvent(new PointerEvent("pointerup", pointer));
    element.dispatchEvent(new MouseEvent("mouseup", at));
    element.dispatchEvent(new MouseEvent("click", at));
  }

  /** A short description of an element for the log, e.g. button[aria-label=Send][icon=send]. */
  function describe(element) {
    if (!element) return "none";
    const icon = element.querySelector?.("[data-icon]")?.getAttribute("data-icon") || element.getAttribute("data-icon");
    const parts = [element.tagName.toLowerCase()];
    for (const name of ["role", "aria-label", "aria-disabled", "disabled"]) {
      if (element.hasAttribute(name)) parts.push(`[${name}=${element.getAttribute(name)}]`);
    }
    if (icon) parts.push(`[icon=${icon}]`);
    return parts.join("");
  }

  function pressEnter(box) {
    box.focus();
    for (const type of ["keydown", "keypress", "keyup"]) {
      box.dispatchEvent(
        new KeyboardEvent(type, {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
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
    const wanted = loose(snippet);
    const holds = (element) => loose(element.textContent).includes(wanted);
    // WhatsApp splits a message's text into nested pieces (formatting, line breaks, emoji), so
    // the match is the innermost element holding the text, whatever else it contains.
    const candidates = [...panel.querySelectorAll("span, div")].filter(
      (element) =>
        holds(element) &&
        ![...element.children].some(holds) &&
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
    // WhatsApp took the text out of the message box when Send was pressed, so it accepted the
    // message even though it could not be found in the chat.
    finish("sent_not_found_in_chat");
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

    if (!loose(opened.caption.textContent).includes(loose(snippet))) {
      trace("writing the caption");
      opened.caption.focus();
      document.execCommand("insertText", false, text);
      await wait(500);
    }

    trace(`pressing send on the picture: ${describe(opened.control)}`);
    press(opened.control);
    await wait(2000);
    if (opened.caption.isConnected && document.body.contains(opened.control)) {
      trace("preview still open, pressing enter in the caption");
      pressEnter(opened.caption);
      await wait(2000);
    }
    // The preview closes once WhatsApp takes the picture; if it is still open, nothing went.
    if (opened.caption.isConnected && document.body.contains(opened.control)) return finish("not_sent");
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
    if (!box) {
      // Says what the message boxes held instead, to see why ours was not recognised.
      const seen = editables()
        .map((field) => {
          const shown = flat(field.textContent);
          return `${describe(field)} ${shown.length} chars "${shown.slice(0, 30)}"`;
        })
        .join(" | ");
      trace(`message box not found; expected ${expected.length} chars "${expected.slice(0, 30)}"; fields: ${seen || "none"}`);
      return finish("timeout_no_text");
    }

    // Let WhatsApp finish setting up the chat before pressing anything.
    await wait(1500);
    if (stopped()) return finish("cancelled");
    box = composerWith(expected) || box;
    const panel = chatPanel(box);
    if (picture) return sendWithImage(box, expected, text, picture, stopped, trace, finish);

    // A few tries, finding the button again each time: the chat can still be settling, and
    // WhatsApp sometimes ignores the first press. Each try waits for the box to empty, so a
    // message that went is never sent twice.
    const ATTEMPTS = 4;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const current = composerWith(expected);
      if (!current) break;
      if (stopped()) return finish("cancelled");
      const button = sendButtonNear(current);
      const useEnter = !button || attempt % 2 === 0;
      trace(
        `attempt ${attempt}: ${useEnter ? "pressing enter" : "pressing send"}; send button ${describe(button)}; ` +
          `${sendControls().length} send control(s) on the page`,
      );
      if (useEnter) pressEnter(current);
      else {
        current.focus();
        press(button);
      }
      await wait(attempt === 1 ? 1500 : 2500);
    }
    if (composerWith(expected)) {
      trace(`gave up; message box ${describe(composerWith(expected))}`);
      return finish("not_sent");
    }

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
