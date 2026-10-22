// -----------------------------------------------------------------------------
// A fake Kaleidescape player on 127.0.0.1, after the emulator of
// pykaleidescape (tests/emulator.py): requests `01/<seq>/<NAME>:`, answers
// `01/<seq>/000:<NAME>:<fields>:/<checksum>`, events `01/!/...`, the power
// and playback commands changing its state, and the misbehaviours the tests
// need (silent, closing, garbage, slow commands, an event flood).
// -----------------------------------------------------------------------------

import net from 'node:net';

export const SERIAL = '00000000123A';
export const SERIAL_ID = SERIAL.toLowerCase();

const encode = (field) =>
  String(field)
    .replace(/\\/g, '\\\\')
    .replace(/\//g, '\\/')
    .replace(/:/g, '\\:')
    .replace(/[À-þ]/g, (c) => `\\d${String(c.charCodeAt(0)).padStart(3, '0')}`);

export async function startFakePlayer(options = {}) {
  const fake = {
    serial: options.serial ?? SERIAL,
    movieZones: options.movieZones ?? '01',
    model: options.model ?? 'Strato S',
    name: options.name ?? 'Théâtre',
    power: options.power ?? '0',
    play: options.play ?? '0',
    chapter: options.chapter ?? '003',
    title: options.title ?? 'Turtle Odyssey: Part 2',
    location: options.location ?? '03',
    videoMode: options.videoMode ?? '37',
    eotf: options.eotf ?? '03',
    /** 'ok' | 'silent' | 'close' | 'garbage' */
    mode: options.mode ?? 'ok',
    /** request name -> 'never' | 'refuse' | ms (answered later) */
    behaviour: options.behaviour ?? {},
    /** a command's effect comes this long after its answer */
    effectMs: options.effectMs ?? 0,
    /** an event line sent before every answer */
    chatty: options.chatty ?? false,
    received: [],
    connections: 0,
    sockets: new Set(),
  };

  const timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };

  const answers = {
    GET_DEVICE_INFO: () => ['DEVICE_INFO', ['', fake.serial, '00', '127.000.000.001']],
    GET_NUM_ZONES: () => ['NUM_ZONES', [fake.movieZones, '01']],
    GET_DEVICE_TYPE_NAME: () => ['DEVICE_TYPE_NAME', [fake.model]],
    GET_FRIENDLY_NAME: () => ['FRIENDLY_NAME', [fake.name]],
    GET_DEVICE_POWER_STATE: () => ['DEVICE_POWER_STATE', [fake.power, fake.power]],
    GET_PLAY_STATUS: () => [
      'PLAY_STATUS',
      [fake.play, '1', '01', '07200', '00600', fake.chapter, '00900', '00100'],
    ],
    GET_PLAYING_TITLE_NAME: () => ['TITLE_NAME', [fake.title]],
    GET_MOVIE_LOCATION: () => ['MOVIE_LOCATION', [fake.location]],
    GET_VIDEO_MODE: () => ['VIDEO_MODE', ['00', '00', fake.videoMode]],
    GET_VIDEO_COLOR: () => ['VIDEO_COLOR', [fake.eotf, '04', '30', '02']],
  };

  const effects = {
    LEAVE_STANDBY: () => {
      fake.power = '1';
    },
    ENTER_STANDBY: () => {
      fake.power = '0';
      fake.play = '0';
    },
    PLAY: () => {
      fake.play = '2';
    },
    PAUSE: () => {
      fake.play = '1';
    },
    STOP: () => {
      fake.play = '0';
    },
  };
  const NAVIGATION = new Set([
    'UP',
    'DOWN',
    'LEFT',
    'RIGHT',
    'SELECT',
    'CANCEL',
    'KALEIDESCAPE_MENU_TOGGLE',
    'STATUS_AND_SETTINGS',
    'NEXT',
    'PREVIOUS',
    'REPLAY',
    'SCAN_FORWARD',
    'SCAN_REVERSE',
    'INTERMISSION_TOGGLE',
    'GO_MOVIE_LIST',
    'GO_MOVIE_COVERS',
    'GO_MOVIE_COLLECTIONS',
  ]);

  function respond(seq, name) {
    if (answers[name]) {
      if (name !== 'GET_DEVICE_INFO' && name !== 'GET_DEVICE_POWER_STATE' && fake.power === '0') {
        if (!['GET_NUM_ZONES', 'GET_DEVICE_TYPE_NAME', 'GET_FRIENDLY_NAME'].includes(name)) {
          return `01/${seq}/020:Device in standby:/89`;
        }
      }
      const [answer, fields] = answers[name]();
      return `01/${seq}/000:${answer}:${fields.map(encode).join(':')}:/89`;
    }
    if (effects[name] || NAVIGATION.has(name)) {
      if (name !== 'LEAVE_STANDBY' && name !== 'ENTER_STANDBY' && fake.power === '0') {
        return `01/${seq}/020:Device in standby:/89`;
      }
      if (effects[name]) {
        if (fake.effectMs > 0) {
          later(effects[name], fake.effectMs);
        } else {
          effects[name]();
        }
      }
      return `01/${seq}/000:/89`;
    }
    return `01/${seq}/010:Invalid request:/89`;
  }

  const server = net.createServer((socket) => {
    fake.connections += 1;
    fake.sockets.add(socket);
    socket.on('close', () => fake.sockets.delete(socket));
    socket.on('error', () => {});
    if (fake.mode === 'close') {
      socket.destroy();
      return;
    }
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        const match = line.match(/^01\/(\d)\/([A-Z_]+):$/);
        if (!match) {
          continue;
        }
        const [, seq, name] = match;
        fake.received.push(name);
        if (fake.mode === 'silent') {
          continue;
        }
        if (fake.mode === 'garbage') {
          socket.write('HELLO WORLD\n');
          continue;
        }
        if (fake.mode === 'flood') {
          socket.write(`01/!/000:UI_STATE:01:00:00:0:/89\n`.repeat(9000));
          continue;
        }
        const behaviour = fake.behaviour[name];
        if (behaviour === 'never') {
          continue;
        }
        if (fake.chatty) {
          socket.write(`01/!/000:UI_STATE:01:00:00:0:/89\n`);
          // A late answer to another sequence number: ignored by the client.
          socket.write(`01/${(Number(seq) + 5) % 10}/000:DEVICE_POWER_STATE:1:1:/89\n`);
        }
        if (behaviour === 'refuse') {
          socket.write(`01/${seq}/012:Invalid parameter:/89\n`);
          continue;
        }
        if (typeof behaviour === 'number') {
          later(() => {
            if (!socket.destroyed) {
              socket.write(`${respond(seq, name)}\n`);
            }
          }, behaviour);
          continue;
        }
        socket.write(`${respond(seq, name)}\n`);
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.port = server.address().port;
  fake.commands = () => fake.received.filter((n) => !n.startsWith('GET_'));
  fake.close = () =>
    new Promise((resolve) => {
      for (const t of timers) {
        clearTimeout(t);
      }
      for (const socket of fake.sockets) {
        socket.destroy();
      }
      server.close(() => resolve());
    });
  return fake;
}
