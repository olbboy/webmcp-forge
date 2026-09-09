/** Tool names must match [a-z0-9_], start with a letter, max 64 chars. */
export function sanitizeToolName(raw: string, used?: Set<string>): string {
  let s = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (!s) s = "tool";
  if (!/^[a-z]/.test(s)) s = `tool_${s}`;
  s = s.slice(0, 64);
  if (!used) return s;
  if (!used.has(s)) {
    used.add(s);
    return s;
  }
  for (let i = 2; i < 100; i++) {
    const suffix = `_${i}`;
    const next = (s.slice(0, 64 - suffix.length) + suffix).slice(0, 64);
    if (!used.has(next)) {
      used.add(next);
      return next;
    }
  }
  const fallback = `tool_${used.size}`;
  used.add(fallback);
  return fallback;
}

export function isValidToolName(name: string): boolean {
  return /^[a-z][a-z0-9_]{0,63}$/.test(name);
}
