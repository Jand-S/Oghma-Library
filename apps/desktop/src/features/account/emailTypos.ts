/** Common e-mail domains, and the misspellings people type for them. */
const DOMAINS = ["gmail.com", "icloud.com", "hotmail.com", "outlook.com", "yahoo.com", "yahoo.com.br", "live.com", "uol.com.br", "bol.com.br", "me.com", "proton.me", "protonmail.com"];
/** Top-level domains typed wrong ("gmail.con"). */
const TLD_FIXES: Record<string, string> = { con: "com", cmo: "com", ocm: "com", comm: "com", cpm: "com", vom: "com", xom: "com", co: "com", "com.bt": "com.br", "con.br": "com.br" };

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/**
 * "voce@gmail.con" → "voce@gmail.com". Null when the address looks right (or is not an address yet).
 * Only well-known providers are corrected by similarity, so a real custom domain is left alone.
 */
export function suggestEmailFix(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (DOMAINS.includes(domain)) return null;
  const dot = domain.indexOf(".");
  if (dot > 0) {
    const tld = domain.slice(dot + 1);
    // ".co" is a real TLD: only fix it for the big providers ("gmail.co").
    const fixed = TLD_FIXES[tld];
    if (fixed && (tld !== "co" || DOMAINS.includes(`${domain.slice(0, dot)}.com`))) domain = `${domain.slice(0, dot)}.${fixed}`;
  }
  if (DOMAINS.includes(domain)) return `${local}@${domain}`;
  let best: string | null = null;
  let bestDistance = 3;
  for (const known of DOMAINS) {
    const d = distance(domain, known);
    if (d < bestDistance) {
      best = known;
      bestDistance = d;
    }
  }
  return best && bestDistance <= 2 ? `${local}@${best}` : null;
}
