import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyDoor } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';

// The Library prints the button in the browser's language ("Надіслати повідомлення"),
// so the door must come from the language-independent cta_type when it is there.

test('door from cta_type when the button text is not English (Ukrainian UI)', () => {
  const ig = 'https://www.instagram.com/salon';
  assert.equal(classifyDoor({ cta: 'Надіслати повідомлення', cta_type: 'INSTAGRAM_MESSAGE', link: ig }), 'Директ/Messenger');
  assert.equal(classifyDoor({ cta: 'Надіслати повідомлення', cta_type: 'MESSAGE_PAGE', link: '' }), 'Директ/Messenger');
  assert.equal(classifyDoor({ cta: 'Відкрити профіль Instagram', cta_type: 'VIEW_INSTAGRAM_PROFILE', link: ig }), 'Instagram-профиль');
  assert.equal(classifyDoor({ cta: 'Надіслати повідомлення у WhatsApp', cta_type: 'WHATSAPP_MESSAGE', link: 'https://api.whatsapp.com/send?phone=1' }), 'WhatsApp');
  assert.equal(classifyDoor({ cta: 'Надіслати повідомлення у WhatsApp', cta_type: 'WHATSAPP_MESSAGE', link: '' }), 'WhatsApp');
  assert.equal(classifyDoor({ cta: 'Зателефонувати', cta_type: 'CALL_NOW', link: '' }), 'Звонок');
  assert.equal(classifyDoor({ cta: 'Докладніше', cta_type: 'LEARN_MORE', link: 'https://salon.example/' }), 'Сайт');
});

test('door still works from the English button text when there is no cta_type (older snapshots)', () => {
  assert.equal(classifyDoor({ cta: 'Send message', link: 'https://www.instagram.com/x' }), 'Директ/Messenger');
  assert.equal(classifyDoor({ cta: 'Learn more', link: 'https://salon.example/' }), 'Сайт');
});
