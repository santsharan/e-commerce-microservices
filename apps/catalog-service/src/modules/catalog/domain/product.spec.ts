import { describe, expect, it } from "vitest";
import { versionFromIfMatch } from "./concurrency.js";
import { etagFor, slugify } from "./product.js";

describe("catalog values", () => {
  it("slugifies names and reads a quoted ETag", () => {
    expect(slugify("Blue Wool Hat")).toBe("blue-wool-hat");
    expect(etagFor(3)).toBe('"3"');
    expect(versionFromIfMatch('"3"')).toBe(3);
    expect(versionFromIfMatch('W/"4"')).toBe(4);
    expect(() => versionFromIfMatch(undefined)).toThrow(/If-Match is required/);
  });
});
