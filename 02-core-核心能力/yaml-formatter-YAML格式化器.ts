import { parseAllDocuments } from "yaml";

export type FormatYamlResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string };

/** Validates and consistently serializes YAML before an explicit Workbench save. */
export function formatYaml(text: string): FormatYamlResult {
  const source = text.replace(/^\uFEFF/, "");
  if (source.trim().length === 0) return { ok: true, text: "" };
  try {
    const documents = parseAllDocuments(source, {
      prettyErrors: true,
      strict: true,
      uniqueKeys: false,
      version: "1.2"
    });
    const error = documents.flatMap((document) => document.errors)[0];
    if (error !== undefined) return { ok: false, error: error.message };
    const formatted = documents
      .map((document) => document.toString({ lineWidth: 120 }).replace(/^---\s*\n/, "").trimEnd())
      .join("\n---\n");
    return { ok: true, text: formatted.length === 0 ? "" : `${formatted}\n` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
