/**
 * One-off migration: remove ₹ and INR wallet labels → Stockex coins wording.
 * Skips landing forex pair symbols (USDINR etc.) and node_modules.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const DIRS = [
  path.join(ROOT, 'client', 'src'),
  path.join(ROOT, 'server'),
];

const SKIP_PARTS = ['node_modules', '.git', 'migrate-to-stockex-coins'];

function shouldProcess(file) {
  if (!/\.(jsx?|tsx?|mjs|cjs)$/.test(file)) return false;
  return !SKIP_PARTS.some((p) => file.includes(p));
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (SKIP_PARTS.some((p) => full.includes(p))) continue;
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (shouldProcess(full)) out.push(full);
  }
  return out;
}

function migrateContent(text) {
  let c = text;
  // Remove rupee symbol everywhere
  c = c.replace(/₹/g, '');
  // UI / label replacements (not forex pair codes like USDINR in strings)
  c = c.replace(/\(INR\)/g, '(Stockex coins)');
  c = c.replace(/Indian Rupees?/gi, 'Stockex coins');
  c = c.replace(/Rupees?\s*\(\)/g, 'Stockex coins');
  c = c.replace(/Rupees?\s*\(/gi, 'Stockex coins (');
  c = c.replace(/'INR'\s*,\s*label:\s*'Rupees[^']*'/g, "'COINS', label: 'Stockex coins'");
  c = c.replace(/label:\s*'Rupees[^']*'/g, "label: 'Stockex coins'");
  c = c.replace(/perTradeUnit:\s*'INR'/g, "perTradeUnit: 'COINS'");
  c = c.replace(/perLotUnit:\s*'INR'/g, "perLotUnit: 'COINS'");
  c = c.replace(/extraCommissionUnit:\s*'INR'/g, "extraCommissionUnit: 'COINS'");
  c = c.replace(/perCroreUnit:\s*'INR'/g, "perCroreUnit: 'COINS'");
  c = c.replace(/suffix:\s*'₹'/g, "suffix: 'Coins'");
  c = c.replace(/return\s+'INR'/g, "return 'COINS'");
  c = c.replace(/All commission types use ₹ \(INR\)/g, 'All commission types use Stockex coins');
  c = c.replace(/PER_CRORE = ₹ per crore/g, 'PER_CRORE = Coins per crore');
  c = c.replace(/Brokerage \(₹ \/ /g, 'Brokerage (Coins / ');
  c = c.replace(/Amount \(₹\)/g, 'Amount (Coins)');
  c = c.replace(/Charge per quantity \(₹\)/g, 'Charge per quantity (Coins)');
  c = c.replace(/₹ per crore turnover/g, 'Coins per crore turnover');
  c = c.replace(/Format INR for/g, 'Format Stockex coins for');
  return c;
}

let changed = 0;
for (const dir of DIRS) {
  for (const file of walk(dir)) {
    const before = fs.readFileSync(file, 'utf8');
    const after = migrateContent(before);
    if (after !== before) {
      fs.writeFileSync(file, after, 'utf8');
      changed++;
    }
  }
}
console.log(`Updated ${changed} files for Stockex coins migration.`);
