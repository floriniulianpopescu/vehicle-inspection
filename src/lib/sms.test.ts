import { describe, expect, test } from "bun:test";
import { clampInterval, sendingSeconds, smsSize, splitDuration } from "./sms";

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

describe("sending time", () => {
  test("there is no wait before the first message", () => {
    expect(sendingSeconds(0, 30)).toBe(0);
    expect(sendingSeconds(1, 30)).toBe(0);
    expect(sendingSeconds(3, 45)).toBe(90);
  });

  test("seconds split into hours, minutes and seconds", () => {
    expect(splitDuration(3930)).toEqual({ hours: 1, minutes: 5, seconds: 30 });
    expect(splitDuration(59)).toEqual({ hours: 0, minutes: 0, seconds: 59 });
    expect(splitDuration(7200)).toEqual({ hours: 2, minutes: 0, seconds: 0 });
  });

  test("the interval is at least 30 seconds", () => {
    expect(clampInterval("10")).toBe(30);
    expect(clampInterval("45")).toBe(45);
    expect(clampInterval("99999")).toBe(3600);
    expect(clampInterval("")).toBeNull();
  });
});
