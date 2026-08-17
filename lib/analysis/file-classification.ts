export const codeExtensions = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "go",
  "java",
  "rb",
  "php",
  "rs",
  "c",
  "cpp",
  "cs",
  "swift",
  "kt",
  "vue",
  "svelte",
]);

export function extensionOf(path: string) {
  const file = path.split("/").at(-1) || "";
  return file.includes(".") ? (file.split(".").at(-1) || "").toLowerCase() : "none";
}
