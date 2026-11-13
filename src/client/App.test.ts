import { describe, expect, it } from "vitest";
import { formatDuration } from "./App.tsx";

describe("formatDuration", () => {
  it("formats durations under an hour as zero-padded mm:ss", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(9)).toBe("00:09");
    expect(formatDuration(60)).toBe("01:00");
    expect(formatDuration(3_599)).toBe("59:59");
  });

  it("formats an hour or more as hours and whole minutes", () => {
    expect(formatDuration(3_600)).toBe("1h 0m");
    expect(formatDuration(5_880)).toBe("1h 38m");
  });
});
