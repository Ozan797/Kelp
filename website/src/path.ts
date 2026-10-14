/** Turns "/docs/s3/", "/docs/s3/index.html" and "/docs/s3" into "/docs/s3". */
export function normalizePath(path: string): string {
  const trimmed = path.replace(/\/index\.html$/, "").replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}
