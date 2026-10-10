#!/usr/bin/env node
// Removes payer names ("Ad paid for by", often a private person) from the
// snapshots of older versions: details.json and the paid_by column of ads.csv.
// What stays is `payer_differs` (the payer is not the advertiser), computed
// from the names before they are deleted. Safe to run again.
//
//   node scrub.js out/fitness-pl/2026-10-10 [more folders...]
//   node scrub.js out/fitness-pl            (every snapshot folder inside)
const fs = require('fs');
const path = require('path');
const C = require('./collector.js');

const hasSnapshot = d => fs.existsSync(path.join(d, 'ads.csv'));
const folders = [];
for (const arg of process.argv.slice(2)) {
  if (hasSnapshot(arg)) folders.push(arg);
  else if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
    for (const e of fs.readdirSync(arg, { withFileTypes: true })) if (e.isDirectory() && hasSnapshot(path.join(arg, e.name))) folders.push(path.join(arg, e.name));
  }
}
if (!folders.length) { console.error('Usage: node scrub.js <snapshot-folder | folder-with-snapshots> ...'); process.exit(1); }

for (const dir of folders) {
  let names = 0;
  // 1. details.json: { ads: { id: { paid_by, ... } } }
  const dp = path.join(dir, 'details.json');
  let det = null;
  if (fs.existsSync(dp)) det = JSON.parse(fs.readFileSync(dp, 'utf8'));
  // 2. ads.csv (the advertiser names are needed to compute the flag)
  const cp = path.join(dir, 'ads.csv');
  const raw = fs.readFileSync(cp, 'utf8');
  const hadColumn = /(^|,)"?paid_by"?(,|\r?\n|$)/.test(raw.split(/\r?\n/)[0]);
  const rows = C.parseCsv(raw); // parseCsv drops the paid_by column
  const nameOf = new Map(rows.map(r => [r.id, r.page]));
  const oldPayer = new Map();
  if (hadColumn) {
    const lines = raw.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
    const cols = lines[0].split(',');
    const idx = cols.indexOf('paid_by'), idId = cols.indexOf('id');
    for (const l of lines.slice(1)) {
      const v = [...l.matchAll(/"((?:[^"]|"")*)"/g)].map(m => m[1].replace(/""/g, '"'));
      if (v[idx]) oldPayer.set(v[idId], v[idx]);
    }
  }
  if (det && det.ads) {
    for (const [id, d] of Object.entries(det.ads)) {
      if ('paid_by' in d) {
        if (d.payer_differs === undefined) d.payer_differs = C.payerDiffers(nameOf.get(id) || '', d.paid_by);
        delete d.paid_by;
        names++;
      }
    }
    fs.writeFileSync(dp, JSON.stringify(det, null, 1), 'utf8');
  }
  if (hadColumn) {
    for (const r of rows) {
      if (r.payer_differs === null && oldPayer.has(r.id)) r.payer_differs = C.payerDiffers(r.page, oldPayer.get(r.id));
    }
    fs.writeFileSync(cp, C.toCsv(rows), 'utf8');
    names += oldPayer.size;
  }
  console.log(`${dir}: ${names ? 'removed payer names from ' + names + ' records' : 'nothing to remove'}`);
}
