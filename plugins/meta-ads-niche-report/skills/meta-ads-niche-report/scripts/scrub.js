#!/usr/bin/env node
// Removes payer and beneficiary names (EU transparency data: they can be
// private persons) from eu.json of snapshots made by versions before 0.14.7.
// What stays is `payer_differs` (the payer is not the beneficiary), computed
// from the names before they are deleted. Safe to run again.
//
//   node scrub.js out/ecom-dropship-us/2026-09-30 [more folders...]
//   node scrub.js out/ecom-dropship-us            (every snapshot folder inside)
const fs = require('fs');
const path = require('path');
const { payerDiffers } = require('./collector.js');

const isSnapshot = d => fs.existsSync(path.join(d, 'ads.csv'));
const folders = [];
for (const arg of process.argv.slice(2)) {
  if (isSnapshot(arg)) folders.push(arg);
  else if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
    for (const e of fs.readdirSync(arg, { withFileTypes: true })) if (e.isDirectory() && isSnapshot(path.join(arg, e.name))) folders.push(path.join(arg, e.name));
  }
}
if (!folders.length) { console.error('Usage: node scrub.js <snapshot-folder | folder-with-snapshots> ...'); process.exit(1); }

for (const dir of folders) {
  const f = path.join(dir, 'eu.json');
  if (!fs.existsSync(f)) { console.log(`${dir}: no eu.json`); continue; }
  const eu = JSON.parse(fs.readFileSync(f, 'utf8'));
  let n = 0;
  for (const d of Object.values((eu && eu.ads) || {})) {
    if (!d || typeof d !== 'object' || !('payer' in d || 'beneficiary' in d)) continue;
    if (d.payer_differs === undefined) d.payer_differs = payerDiffers(d.beneficiary, d.payer);
    delete d.payer;
    delete d.beneficiary;
    n++;
  }
  fs.writeFileSync(f, JSON.stringify(eu, null, 2), 'utf8');
  console.log(`${dir}: ${n ? 'removed payer and beneficiary names from ' + n + ' ads' : 'nothing to remove'}`);
}
