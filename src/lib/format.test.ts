import { describe, expect, it } from "vitest";
import { money, num, STATUS_LABELS } from "./format";

describe("money", () => {
  it("formats tenths of a million pound as £m with one decimal", () => {
    expect(money(147)).toBe("£14.7m");
  });

  it("formats zero", () => {
    expect(money(0)).toBe("£0.0m");
  });

  it("formats values under a tenth of a million", () => {
    expect(money(5)).toBe("£0.5m");
  });

  it("formats negative values", () => {
    expect(money(-10)).toBe("£-1.0m");
  });
});

describe("num", () => {
  it("formats a number with locale separators", () => {
    expect(num(1234567)).toBe("1,234,567");
  });

  it("formats zero as 0, not an em dash", () => {
    expect(num(0)).toBe("0");
  });

  it("returns an em dash for null", () => {
    expect(num(null)).toBe("—");
  });

  it("returns an em dash for undefined", () => {
    expect(num(undefined)).toBe("—");
  });
});

describe("STATUS_LABELS", () => {
  it("has a label for every FPL status code", () => {
    expect(STATUS_LABELS).toEqual({
      d: "Doubtful",
      i: "Injured",
      s: "Suspended",
      u: "Unavailable",
      n: "Not in squad",
    });
  });
});
