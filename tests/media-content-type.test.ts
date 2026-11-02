import { describe, expect, test } from "bun:test";
import { inertMediaContentType } from "../src/web/control-server";

describe("attachment content types (BUG-19)", () => {
  test("viewable attachments get their real type", () => {
    expect(inertMediaContentType("2026_x_ABC.pdf")).toBe("application/pdf");
    expect(inertMediaContentType("photo.JPG")).toBe("image/jpeg");
    expect(inertMediaContentType("voice.ogg")).toBe("audio/ogg");
  });

  test("active or unknown content stays a download (never runs in the panel origin)", () => {
    for (const name of ["page.html", "logo.svg", "x.js", "x.xhtml", "noext", "doc.docx"]) {
      expect(inertMediaContentType(name)).toBe("application/octet-stream");
    }
  });
});
