import { describe, expect, test } from "bun:test";
import { formatPhone, isRomanianPhone, isRomanianPlate, typingPhone } from "./romanian";

describe("plates", () => {
  test("Bucharest takes two or three digits, other counties two", () => {
    for (const plate of ["B 12 ABC", "B123ABC", "b-123-abc", "CJ 12 XYZ", "IF09DEF"]) {
      expect(isRomanianPlate(plate)).toBe(true);
    }
    for (const plate of ["CJ 123 ABC", "XX 12 ABC", "B 1 ABC", "B12AB", "WOB123", "AB 12 3CD"]) {
      expect(isRomanianPlate(plate)).toBe(false);
    }
  });

  test("temporary plates are a county and six digits", () => {
    expect(isRomanianPlate("B 012345")).toBe(true);
    expect(isRomanianPlate("TM 123456")).toBe(true);
    expect(isRomanianPlate("TM 12345")).toBe(false);
  });
});

describe("phones", () => {
  test("mobile and landline numbers, written any usual way", () => {
    for (const phone of ["0722 123 456", "+40 722-123-456", "0040722123456", "021 123 4567", "(0264) 123456"]) {
      expect(isRomanianPhone(phone)).toBe(true);
    }
  });

  test("too short, too long or foreign numbers are flagged", () => {
    for (const phone of ["0722 123 45", "07221234567", "+39 333 1234567", "0800123456", "abc"]) {
      expect(isRomanianPhone(phone)).toBe(false);
    }
  });
});

describe("phone display", () => {
  test("ten-digit numbers are shown as 07xx xxx xxx", () => {
    expect(formatPhone("0722123456")).toBe("0722 123 456");
    expect(formatPhone("+40722123456")).toBe("0722 123 456");
    expect(formatPhone("+39 333 1234567")).toBe("+39 333 1234567");
  });

  test("numbers are spaced while typed", () => {
    expect(typingPhone("0722")).toBe("0722");
    expect(typingPhone("07221")).toBe("0722 1");
    expect(typingPhone("0722 1234")).toBe("0722 123 4");
    expect(typingPhone("0722123456")).toBe("0722 123 456");
    expect(typingPhone("Popescu")).toBe("Popescu");
  });
});
