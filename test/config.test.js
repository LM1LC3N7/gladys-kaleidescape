import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressKey, normalizeConfig, parseAddress, parsePollInterval } from '../src/config.js';

test('addresses: IPv4 or host name, port 10000 by default', () => {
  assert.deepEqual(parseAddress('192.168.1.60'), { host: '192.168.1.60', port: 10000 });
  assert.deepEqual(parseAddress(' Strato.local:10001 '), { host: 'strato.local', port: 10001 });
  assert.deepEqual(parseAddress('tcp://192.168.1.60/'), { host: '192.168.1.60', port: 10000 });
  for (const bad of ['', '999.1.1.1', '1.2.3', 'a_b', 'host:0', 'host:70000', 'a..b']) {
    assert.equal(parseAddress(bad), undefined, bad);
  }
  assert.equal(addressKey({ host: 'a', port: 10000 }), 'a');
  assert.equal(addressKey({ host: 'a', port: 10001 }), 'a:10001');
});

test('the configuration is normalized', () => {
  const config = normalizeConfig({
    addresses: '192.168.1.60, 192.168.1.60;bad_one 192.168.1.61:10001',
    poll_interval: '5',
  });
  assert.deepEqual(
    config.addresses.map((a) => addressKey(a)),
    ['192.168.1.60', '192.168.1.61:10001'],
  );
  assert.deepEqual(config.invalid, ['bad_one']);
  assert.equal(config.pollInterval, 10);
  assert.equal(normalizeConfig().pollInterval, 15);
  assert.equal(parsePollInterval('abc'), 15);
  assert.equal(parsePollInterval(true), 15);
  assert.equal(parsePollInterval(900), 300);
});
