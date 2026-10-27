/** True for a path inside this app: starts with a single "/" (not "//" or "/\", which browsers read as another site). */
export function isInAppPath(path: unknown): path is string {
  return typeof path === "string" && /^\/(?![/\\])/.test(path);
}
