// The CoinDCX discovery probe, for anyone running from a local checkout.
//
// The logic lives in lib/coindcx.ts, shared with /api/coindcx-probe — the same
// reasoning as one tag tokenizer and one search index. This file only supplies
// the credentials and prints the report.
//
// Put the credentials in .env.local (gitignored, and the same file Next reads
// in local dev), then:
//
//   npx tsx scripts/coindcx-probe.ts
//
// Reading them from a file rather than the command line is deliberate: a secret
// typed into a shell lands in your shell history, and one containing a `$` or a
// `!` gets silently mangled by the shell before the script ever sees it. Real
// environment variables still win when they are set.
//
// If you have no local checkout — the app is developed entirely in cloud
// sessions — use /api/coindcx-probe on the deployment instead. Same output.
//
// Generate the key with READ-ONLY permission. This never needs trade or
// withdrawal permission.

import { readFileSync } from "node:fs";
import path from "node:path";
import { credentialsFromEnv, formatProbeReport, probeFuturesEndpoints, type CoindcxCredentials } from "@/lib/coindcx";

/**
 * Read one key out of .env.local. Deliberately tiny and dependency-free — it
 * only has to handle `NAME=value`, optionally quoted, which is the whole format
 * anyone writes by hand.
 */
function fromEnvFile(name: string): string {
  try {
    const file = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of file.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      if (trimmed.slice(0, separator).trim() !== name) continue;
      return trimmed
        .slice(separator + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local is a normal state — fall through to the guidance below.
  }
  return "";
}

function credentials(): CoindcxCredentials | null {
  const fromEnv = credentialsFromEnv();
  if (fromEnv) return fromEnv;
  const key = fromEnvFile("COINDCX_API_KEY");
  const secret = fromEnvFile("COINDCX_API_SECRET");
  return key && secret ? { key, secret } : null;
}

async function main() {
  const found = credentials();
  if (!found) {
    console.error("No CoinDCX credentials found.\n");
    console.error("Add these two lines to .env.local in the project root:\n");
    console.error('  COINDCX_API_KEY="your-key-here"');
    console.error('  COINDCX_API_SECRET="your-secret-here"\n');
    console.error("Then run this again:  npx tsx scripts/coindcx-probe.ts\n");
    console.error(".env.local is gitignored, so it never gets committed.");
    console.error("Use a READ-ONLY key. This never needs trade permission.");
    process.exit(1);
  }

  console.log(formatProbeReport(await probeFuturesEndpoints(found)));
}

void main();
