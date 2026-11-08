import { describe, expect, test } from "bun:test";
import { sendingMinutes, smsSize } from "./sms";

describe("smsSize", () => {
  test("plain text fits 160 characters in one SMS", () => {
    expect(smsSize("a".repeat(160))).toEqual({ characters: 160, parts: 1 });
    expect(smsSize("a".repeat(161))).toEqual({ characters: 161, parts: 2 });
  });

  test("Romanian diacritics shrink one SMS to 70 characters", () => {
    expect(smsSize("ă".repeat(70))).toEqual({ characters: 70, parts: 1 });
    expect(smsSize("ă".repeat(71))).toEqual({ characters: 71, parts: 2 });
  });

  test("extended symbols count double", () => {
    expect(smsSize("€")).toEqual({ characters: 2, parts: 1 });
  });
});

describe("sendingMinutes", () => {
  test("rounds up, with no wait before the first message", () => {
    expect(sendingMinutes(1)).toBe(0);
    expect(sendingMinutes(2)).toBe(1);
    expect(sendingMinutes(201)).toBe(100);
  });
});
