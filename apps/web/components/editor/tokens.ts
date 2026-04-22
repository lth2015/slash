// Client-side heuristic tokenizer for CommandBar syntax highlighting.
// Mirrors apps/api/slash_api/parser/lexer.py rules closely — this is for *coloring*,
// not validation. The server /parse remains authoritative for correctness.

export type TokenKind =
  | "slash"
  | "namespace"
  | "target"
  | "noun"
  | "verb"
  | "flag"
  | "value"
  | "duration"
  | "string"
  | "ref"
  | "unknown";

export interface ColorToken {
  from: number; // inclusive char offset
  to: number;   // exclusive
  kind: TokenKind;
  text: string;
}

const NAMESPACES = new Set(["infra", "cluster", "app", "ops"]);
const TARGETED_NS = new Set(["infra", "cluster"]);
const LETTER = /[A-Za-z_]/;
const ID_TAIL = /[A-Za-z0-9_\-./=]/;
const DIGIT = /[0-9]/;

export function highlightTokens(text: string): ColorToken[] {
  const out: ColorToken[] = [];
  if (!text.startsWith("/")) return out;
  out.push({ from: 0, to: 1, kind: "slash", text: "/" });

  // The "shape" stepping — same sequence as the server parser but lenient (we don't
  // throw on malformed, we just mark `unknown`).
  let i = 1;
  const n = text.length;
  const words: { from: number; to: number; text: string }[] = [];
  const flags: { from: number; to: number; name: string; valueFrom?: number; valueTo?: number; valueText?: string }[] = [];

  while (i < n) {
    // skip single space — if there are doubles or trailing, we don't paint them;
    // the server will surface the error.
    if (text[i] === " ") {
      i += 1;
      continue;
    }
    if (text[i] === "-" && text[i + 1] === "-") {
      // flag
      const start = i;
      i += 2;
      const nameStart = i;
      while (i < n && /[a-z0-9-]/.test(text[i])) i += 1;
      const name = text.slice(nameStart, i);
      let valueFrom: number | undefined;
      let valueTo: number | undefined;
      let valueText: string | undefined;
      if (text[i] === "=") {
        valueFrom = i + 1;
        if (text[valueFrom] === '"') {
          // quoted attached value
          const [end, cooked] = readString(text, valueFrom);
          valueTo = end;
          valueText = cooked;
          i = end;
        } else {
          let j = valueFrom;
          while (j < n && text[j] !== " ") j += 1;
          valueTo = j;
          valueText = text.slice(valueFrom, j);
          i = j;
        }
      }
      flags.push({ from: start, to: i, name, valueFrom, valueTo, valueText });
      continue;
    }
    if (text[i] === '"') {
      const [end, cooked] = readString(text, i);
      // a quoted word acts as a "string" token
      out.push({ from: i, to: end, kind: "string", text: cooked });
      i = end;
      continue;
    }
    // word / ref / number
    const start = i;
    if (text[i] === "@") {
      i += 1;
      while (i < n && ID_TAIL.test(text[i])) i += 1;
      out.push({ from: start, to: i, kind: "ref", text: text.slice(start, i) });
      continue;
    }
    if (LETTER.test(text[i])) {
      i += 1;
      while (i < n && ID_TAIL.test(text[i])) i += 1;
      words.push({ from: start, to: i, text: text.slice(start, i) });
      continue;
    }
    if (DIGIT.test(text[i])) {
      i += 1;
      while (i < n && DIGIT.test(text[i])) i += 1;
      if (i < n && /[smhd]/.test(text[i])) i += 1;
      out.push({ from: start, to: i, kind: "duration", text: text.slice(start, i) });
      continue;
    }
    // unknown char — advance one and mark
    out.push({ from: start, to: start + 1, kind: "unknown", text: text[start] });
    i += 1;
  }

  // Classify `words` by position: namespace / target / noun / verb.
  // Simple rule: first word = namespace, second word = target if NS is in TARGETED_NS,
  // rest = nouns, last in the chain = verb.
  if (words.length > 0) {
    const first = words[0];
    out.push({ ...first, kind: NAMESPACES.has(first.text) ? "namespace" : "unknown" });
    let nextIdx = 1;
    if (TARGETED_NS.has(first.text) && words.length > 1) {
      const t = words[1];
      out.push({ ...t, kind: "target" });
      nextIdx = 2;
    }
    const rest = words.slice(nextIdx);
    if (rest.length > 0) {
      const last = rest[rest.length - 1];
      for (let k = 0; k < rest.length - 1; k += 1) {
        out.push({ ...rest[k], kind: "noun" });
      }
      out.push({ ...last, kind: "verb" });
    }
  }

  // Emit flag tokens (split into name + optional value for different styling).
  for (const f of flags) {
    const nameEnd = f.valueFrom != null ? f.valueFrom - 1 : f.to;
    out.push({ from: f.from, to: nameEnd, kind: "flag", text: text.slice(f.from, nameEnd) });
    if (f.valueFrom != null && f.valueTo != null) {
      const isString = text[f.valueFrom] === '"';
      out.push({
        from: f.valueFrom,
        to: f.valueTo,
        kind: isString ? "string" : "value",
        text: f.valueText ?? "",
      });
    }
  }

  // Values standing next to a flag without '=': any `word` / `duration` / `string`
  // that directly follows a FLAG token becomes a `value` visually. We do this by
  // re-labeling words after flags (excluding the namespace/target/noun/verb we already set).
  // Note: words list order is preserved. A "flag-without-=" owns its subsequent word.
  // This is a heuristic; the server parse is authoritative.

  return out.sort((a, b) => a.from - b.from);
}

function readString(text: string, start: number): [number, string] {
  // returns [endExclusive, cookedValue]. Minimal: handles \" escape.
  const n = text.length;
  let i = start + 1;
  let buf = "";
  while (i < n) {
    if (text[i] === "\\" && text[i + 1] === '"') {
      buf += '"';
      i += 2;
      continue;
    }
    if (text[i] === '"') return [i + 1, buf];
    buf += text[i];
    i += 1;
  }
  return [n, buf]; // unterminated — caller is lenient
}
