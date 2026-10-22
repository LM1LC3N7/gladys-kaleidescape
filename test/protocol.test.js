// -----------------------------------------------------------------------------
// The protocol, pure: request lines, answer and event parsing (cases of the
// pykaleidescape tests), value maps, and hostile lines.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REMOTE_KEYS,
  parseEotf,
  parseLine,
  parseMovieLocation,
  parseNumZones,
  parsePlayStatus,
  parsePower,
  parseSerial,
  parseText,
  parseVideoMode,
  requestLine,
} from '../src/kaleidescape/protocol.js';

test('request lines', () => {
  assert.equal(requestLine(0, 'GET_DEVICE_INFO'), '01/0/GET_DEVICE_INFO:\n');
  assert.equal(requestLine(9, 'PLAY'), '01/9/PLAY:\n');
  assert.throws(() => requestLine(10, 'PLAY'));
  assert.throws(() => requestLine(1, 'PLAY:\n01/2/STOP'));
});

test('answers, acknowledgements, events and errors', () => {
  assert.deepEqual(parseLine('01/1/000:DEVICE_POWER_STATE:1:1:/89'), {
    deviceId: '01',
    zone: 0,
    seq: 1,
    status: 0,
    name: 'DEVICE_POWER_STATE',
    fields: ['1', '1'],
  });
  assert.deepEqual(parseLine('01/3/000:/89'), {
    deviceId: '01',
    zone: 0,
    seq: 3,
    status: 0,
    name: '',
    fields: [],
  });
  const event = parseLine('01.01/!/000:PLAY_STATUS:2:0:01:07200:00600:003:00900:00100:/79');
  assert.equal(event.seq, -1);
  assert.equal(event.zone, 1);
  const error = parseLine('01/2/020:Device in standby:/89');
  assert.deepEqual([error.status, error.name, error.fields], [20, 'Device in standby', []]);
  assert.equal(parseLine('#00000000123A/!/000:TITLE_NAME:X:/1').deviceId, '#00000000123A');
});

test('escaped fields: slash, colon, backslash, \\dNNN and the newline bug', () => {
  const line = parseLine('01/1/000:TITLE_NAME:Th\\d233\\d226tre\\: a\\/b \\\\ c:/1');
  assert.deepEqual(line.fields, ['Théâtre: a/b \\ c']);
  assert.deepEqual(parseLine('01/1/000:X:a\\nb:\\t:/1').fields, ['a\nb', '\t']);
  assert.deepEqual(parseLine('01/1/000:X::/1').fields, ['']);
});

test('hostile lines are refused, never thrown', () => {
  const bad = [
    '',
    'HELLO WORLD',
    '01/1/000:X:unterminated/1',
    '01/1/000:X:a:/',
    '01/1/000:X:a:/12x',
    '01/1/000:X:a:',
    '01/x/000:X:a:/1',
    '01/1/0a0:X:a:/1',
    '1/1/000:X:a:/1',
    '01.1/1/000:X:a:/1',
    '01/1/000:X:\\d2:/1',
    `01/1/000:X:${'a:'.repeat(40)}/1`,
    `01/1/000:X:${'a'.repeat(600)}:/1`,
    `01/1/000:${'N'.repeat(80)}:a:/1`,
    '#/1/000:X:a:/1',
  ];
  for (const line of bad) {
    assert.equal(parseLine(line), undefined, line);
  }
  assert.equal(parseLine(undefined), undefined);
  // Linear: a long line is parsed at once.
  const started = Date.now();
  parseLine(`01/1/000:X:${'\\\\'.repeat(200)}:/1`);
  assert.ok(Date.now() - started < 50);
});

test('values through fixed tables', () => {
  assert.equal(parseSerial(['', '00000000123A', '00', '127.0.0.1']), '00000000123a');
  assert.equal(parseSerial(['', '#123', '00']), '000000000123');
  assert.equal(parseSerial(['', 'ABCDEF0123456789', '00']), 'ef0123456789');
  assert.equal(parseSerial(['', '000000000000']), undefined);
  assert.equal(parseSerial(['', 'a b']), undefined);
  assert.equal(parseSerial(['']), undefined);
  assert.equal(parsePower(['1', '1']), 'on');
  assert.equal(parsePower(['0']), 'standby');
  assert.equal(parsePower(['7']), undefined);
  assert.equal(parsePower(['__proto__']), undefined);
  assert.deepEqual(parseNumZones(['01', '01']), { movie: 1, music: 1 });
  assert.deepEqual(parsePlayStatus(['2', '1', '01', '07200', '00600', '003', '00900', '00100']), {
    status: 'playing',
    chapter: 3,
  });
  assert.equal(parsePlayStatus(['3']), undefined);
  assert.equal(parsePlayStatus(['constructor']), undefined);
  assert.equal(parseMovieLocation(['05']), 'credits');
  assert.equal(parseVideoMode(['00', '00', '37']), '3840x2160p24_16:9');
  assert.equal(parseVideoMode(['00', '00', '18']), undefined);
  assert.equal(parseEotf(['03']), 'smpte_st2084');
  assert.equal(parseText(['  Hello\u0007 world ']), 'Hello  world');
  assert.equal(parseText(['']), undefined);
  assert.equal(parseText(['x'.repeat(300)], 100).length, 100);
});

test('remote keys: frozen values, protocol requests', () => {
  const values = REMOTE_KEYS.map((k) => k.value);
  assert.equal(new Set(values).size, values.length);
  for (const key of REMOTE_KEYS) {
    assert.match(key.value, /^[a-z][a-z-]*$/);
    assert.match(key.request, /^[A-Z_]+$/);
    assert.ok(!['ENTER_STANDBY', 'LEAVE_STANDBY', 'PLAY', 'PAUSE', 'STOP'].includes(key.request));
  }
});
