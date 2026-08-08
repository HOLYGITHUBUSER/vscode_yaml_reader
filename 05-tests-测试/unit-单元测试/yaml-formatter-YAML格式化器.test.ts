import { describe, expect, it } from "vitest";
import { formatYaml } from "../../02-core-核心能力/yaml-formatter-YAML格式化器";

describe("formatYaml", () => {
  it("formats valid multi-document YAML", () => {
    expect(formatYaml("name:  test\n---\nenabled: true")).toEqual({
      ok: true,
      text: "name: test\n---\nenabled: true\n"
    });
  });

  it("rejects malformed YAML without returning replacement text", () => {
    const result = formatYaml("name: [broken");
    expect(result.ok).toBe(false);
  });

  it("keeps blank documents blank and accepts a BOM", () => {
    expect(formatYaml("  \n")).toEqual({ ok: true, text: "" });
    expect(formatYaml("\uFEFFname: reader")).toEqual({
      ok: true,
      text: "name: reader\n"
    });
  });
});
