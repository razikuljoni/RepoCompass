import type { CodeGraphV2 } from "../domain/code-graph.ts";
import type { RepositorySnapshot } from "../domain/repository-snapshot.ts";

export type SourceFileInput = {
  path: string;
  content: string;
};

export type CodeGraphParserInput = {
  snapshot: RepositorySnapshot;
  files: readonly SourceFileInput[];
};

export type CodeGraphParser = {
  id: string;
  version: string;
  supports(path: string): boolean;
  parse(input: CodeGraphParserInput): CodeGraphV2;
};

export function dispatchCodeGraphParser(
  input: CodeGraphParserInput,
  parsers: readonly CodeGraphParser[],
): CodeGraphV2 {
  const matching = parsers.filter((parser) =>
    input.files.some((file) => parser.supports(file.path)),
  );
  if (matching.length === 0 && parsers.length === 1) return parsers[0].parse(input);
  if (matching.length === 0)
    throw new Error("No code graph parser supports the supplied source files");
  if (matching.length > 1) {
    throw new Error(
      `Multiple code graph parsers support the supplied source files: ${matching
        .map((parser) => parser.id)
        .sort()
        .join(", ")}`,
    );
  }
  return matching[0].parse(input);
}
