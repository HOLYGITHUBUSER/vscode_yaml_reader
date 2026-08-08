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

  it("rejects duplicate mapping keys before a Workbench save", () => {
    const result = formatYaml("name: first\nname: second\n");

    expect(result.ok).toBe(false);
  });

  it("does not lose precision when saving a large integer", () => {
    expect(formatYaml("total: 9007199254740993\n")).toEqual({
      ok: true,
      text: "total: 9007199254740993\n"
    });
  });

  it("keeps duplicate-key validation linear for a 20,000-entry mapping", () => {
    const source = Array.from(
      { length: 20_000 },
      (_, index) => `key_${index}: value_${index}`
    ).join("\n");
    const startedAt = performance.now();
    const result = formatYaml(source);

    expect(result.ok).toBe(true);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  }, 10_000);
});
