import { describe, expect, it } from "vitest";
import { isValidToolName, sanitizeToolName } from "@/lib/names";
import { pathAllowedByRobots } from "@/lib/robots";

describe("sanitizeToolName", () => {
  it("keeps [a-z0-9_] and uniquifies", () => {
    expect(sanitizeToolName("fill_form_Contact!")).toBe("fill_form_contact");
    expect(isValidToolName(sanitizeToolName("123go"))).toBe(true);
    const used = new Set<string>();
    const a = sanitizeToolName("open_path", used);
    const b = sanitizeToolName("open_path", used);
    expect(a).toBe("open_path");
    expect(b).toBe("open_path_2");
  });
});

describe("robots.txt light parser", () => {
  it("honors Disallow: / for *", () => {
    const txt = "User-agent: *\nDisallow: /\n";
    expect(pathAllowedByRobots(txt, "/")).toBe(false);
    expect(pathAllowedByRobots(txt, "/about")).toBe(false);
  });

  it("allows when blank", () => {
    expect(pathAllowedByRobots("", "/secret")).toBe(true);
  });
});
