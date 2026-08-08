import { isMap, isScalar, isSeq, parseAllDocuments, type Node } from "yaml";

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
      // yaml's native duplicate-key option compares each pair with every
      // preceding pair. Keep large Workbench saves responsive by scanning the
      // parsed map tree once below instead.
      uniqueKeys: false,
      intAsBigInt: true,
      version: "1.2"
    });
    const error = documents.flatMap((document) => document.errors)[0];
    if (error !== undefined) return { ok: false, error: error.message };
    const duplicateKey = findDuplicateMappingKey(
      documents.map((document) => document.contents)
    );
    if (duplicateKey !== undefined) {
      return { ok: false, error: `Map keys must be unique: ${duplicateKey}` };
    }
    const formatted = documents
      .map((document) => document.toString({ lineWidth: 120 }).replace(/^---\s*\n/, "").trimEnd())
      .join("\n---\n");
    return { ok: true, text: formatted.length === 0 ? "" : `${formatted}\n` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function findDuplicateMappingKey(
  roots: readonly (Node | null)[]
): string | undefined {
  const stack: Node[] = roots.filter((node): node is Node => node !== null);
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) continue;
    if (isMap(node)) {
      const seenScalarKeys = new Set<unknown>();
      for (const pair of node.items) {
        if (isScalar(pair.key)) {
          const keyValue = pair.key.value;
          // Match yaml's built-in === comparator: NaN is not equal to itself.
          if (!(typeof keyValue === "number" && Number.isNaN(keyValue))) {
            const identity = scalarKeyIdentity(keyValue);
            if (seenScalarKeys.has(identity)) {
              return formatDuplicateKey(keyValue);
            }
            seenScalarKeys.add(identity);
          }
        }
        if (isNode(pair.key)) stack.push(pair.key);
        if (isNode(pair.value)) stack.push(pair.value);
      }
      continue;
    }
    if (isSeq(node)) {
      for (const item of node.items) {
        if (isNode(item)) stack.push(item);
      }
    }
  }
  return undefined;
}

function isNode(value: unknown): value is Node {
  return value !== null && (isMap(value) || isSeq(value) || isScalar(value));
}

function formatDuplicateKey(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function scalarKeyIdentity(value: unknown): unknown {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  return value;
}
