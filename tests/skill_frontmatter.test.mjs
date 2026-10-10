// SKILL.md of both plugins must pass the upload check of claude.ai:
//  - the description has no <...> (read as an XML tag)
//  - the description is at most 1024 characters
//  - the name matches the folder name
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins');

for (const name of ['meta-ads-niche-report', 'tiktok-ads-niche-report']) {
  test(`${name}: SKILL.md frontmatter fits claude.ai`, () => {
    const md = fs.readFileSync(path.join(root, name, 'skills', name, 'SKILL.md'), 'utf8');
    const fm = md.match(/^---\r?\n([^]*?)\r?\n---/)[1];
    assert.ok(!/<[^>]*>/.test(fm), 'frontmatter contains <...>');
    const desc = fm.match(/^description: '?(.*?)'?\s*$/m)[1];
    assert.ok(desc.length <= 1024, `description is ${desc.length} chars, claude.ai allows 1024`);
    assert.equal(fm.match(/^name: (.*?)\s*$/m)[1], name);
  });
}
