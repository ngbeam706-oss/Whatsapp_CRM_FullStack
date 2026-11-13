// Guards against a Windows trap: rewriting a file with Windows PowerShell 5.1
// (Get-Content / Set-Content without -Encoding) reads UTF-8 as ANSI, so ₹, emoji and Telugu text
// turn into garbage like "â‚¹" or "ðŸ“£", and it adds a byte-order mark. Happened once on
// 2026-11-09 (server/campaigns.cjs); this test fails if it ever happens again.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['server', 'src', 'netlify/functions', 'tests', 'e2e', 'supabase/migrations'];
const EXT = /\.(c?js|jsx|tsx?|sql|json|html|css)$/;

// UTF-8 bytes of common characters decoded as Windows-1252: â€™ â€“ â‚¹ ðŸ… Ã© Â ...
const MOJIBAKE = /â€|â‚|ðŸ|Ã[\u0080-¿ -ÿ]|Â[ -¿]/;

function* files(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(rel);
    else if (EXT.test(entry.name)) yield rel;
  }
}

test('source files are clean UTF-8: no byte-order mark, no garbled characters', () => {
  const problems = [];
  let checked = 0;
  for (const dir of DIRS) {
    for (const rel of files(dir)) {
      if (rel.endsWith('encoding.test.cjs')) continue; // this file names the patterns on purpose
      const buf = fs.readFileSync(path.join(ROOT, rel));
      checked++;
      if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) problems.push(`${rel}: starts with a byte-order mark`);
      const text = buf.toString('utf8');
      if (text.includes('�')) problems.push(`${rel}: contains invalid UTF-8`);
      const m = text.match(MOJIBAKE);
      if (m) {
        const line = text.slice(0, m.index).split('\n').length;
        problems.push(`${rel}:${line}: garbled text "${m[0]}" (UTF-8 read as ANSI?)`);
      }
    }
  }
  assert.ok(checked > 50, `expected to scan the project, scanned ${checked} files`);
  assert.deepStrictEqual(problems, []);
});
