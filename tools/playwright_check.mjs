import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const url = process.argv[2];

if (!url) {
  console.error('Usage: node tools/playwright_check.mjs <url>');
  process.exit(1);
}

const browserPaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const existingPath = browserPaths.find((path) => {
  return existsSync(path);
});

if (!existingPath) {
  console.error('No local Chrome or Edge executable found.');
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: existingPath,
  headless: true,
});

const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
console.log(await page.title());
await browser.close();
