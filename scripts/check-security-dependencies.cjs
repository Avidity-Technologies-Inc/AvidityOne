// Read-only gate for the reviewed October 2026 dependency advisories.
const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');
const root = path.resolve(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const minimums = {
  next: '16.3.8', sharp: '0.35.5', multer: '2.4.0', 'sanitize-html': '2.17.7',
  postcss: '8.5.23', qs: '6.16.0', 'fast-uri': '3.1.8', browserslist: '4.28.7',
  'baseline-browser-mapping': '2.11.0', nanoid: '3.3.18', 'shell-quote': '1.11.0', uuid: '11.1.1', 'proxy-addr': '2.0.8', 'source-map-js': '1.2.2', handlebars: '4.7.10'
};
const checked = new Set();
for (const [location, item] of Object.entries(lock.packages)) {
  if (!location.includes('node_modules/')) continue;
  const name = location.split('node_modules/').pop();
  let minimum = minimums[name];
  if (name === 'js-yaml') minimum = semver.major(item.version) === 3 ? '3.15.2' : '4.3.2';
  if (name === 'brace-expansion') minimum = {1:'1.1.21',2:'2.1.7',5:'5.0.12'}[semver.major(item.version)];
  if (!minimum) continue;
  if (!semver.gte(item.version, minimum)) throw new Error(`Unpatched dependency: ${location}@${item.version}`);
  const installed = JSON.parse(fs.readFileSync(path.join(root, location, 'package.json'), 'utf8'));
  if (installed.version !== item.version) throw new Error(`Installed dependency differs from lockfile: ${location}`);
  checked.add(name);
}
for (const name of [...Object.keys(minimums), 'js-yaml', 'brace-expansion']) {
  if (!checked.has(name)) throw new Error(`Reviewed dependency missing from verification: ${name}`);
}
const sharp = require(path.join(root, 'node_modules/sharp'));
if (!semver.gte(sharp.versions.heif || '0.0.0', '1.23.2')) throw new Error('Sharp must load a patched libheif >=1.23.2.');
if (!semver.gte(sharp.versions.rsvg || '0.0.0', '2.63.2')) throw new Error('Sharp must load a patched librsvg >=2.63.2.');
console.log(`Verified ${checked.size} dependency families, installed versions, libheif ${sharp.versions.heif}, and librsvg ${sharp.versions.rsvg}.`);
