# gladys-kaleidescape

[Gladys Assistant](https://gladysassistant.com) external integration for
**Kaleidescape movie players** (Strato, Compact Terra Prevue, Alto, Cinema
One, M-Class), on the local network: power on and standby (buttons, never a
switch), play, pause, stop, remote keys, play status, title, chapter, movie
location and video format, through the control protocol published by
Kaleidescape (TCP 10000), without any cloud. Unofficial, not affiliated with
Kaleidescape.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress.** First milestone, tested against a fake player only,
> never with a real Kaleidescape device.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (KaleidescapeApp)
                                   ├─ src/kaleidescape/client.js    one TCP session: requests with sequence numbers, bounded reads (ported)
                                   ├─ src/kaleidescape/protocol.js  lines, escaped fields, value maps, remote keys (ported, pure)
                                   ├─ src/model.js                  known players -> Gladys devices and states (pure)
                                   ├─ src/publisher.js              changed states only, 240 states / min at most
                                   └─ src/store.js                  /data/kaleidescape.json: players, time of the last reads
```

- **Players** are added by IP address (configuration; no network
  discovery). Each one is identified by its serial number (`DEVICE_INFO`,
  last 12 characters, lowercased, as pykaleidescape): external id
  `player:<serial>`. Servers without a movie zone are not offered.
- **One short session per read and per command**: requests
  `01/<seq>/<NAME>:` answered with their sequence number; events and late
  answers are read and dropped. A read: serial number, (name, model, zones
  once an hour), power, then, when on, play status, title, movie location,
  video mode and color. Never sooner than the interval (the time of the last
  read is kept in `/data`, written before the read, at most once a minute);
  a late read of an old configuration publishes nothing.
- **Commands**: validated first; Power on, Play and remote keys are queued
  per player and decided on the state read just before; Standby, Pause and
  Stop are protective (never queued, never refused for an unread state,
  they cancel the waking commands waiting, even a running one before its
  line leaves). Each within a 3.5 s budget, the line never sent after it,
  confirmed only by a value read back ("sent, without confirmation"
  otherwise); the ack never waits for the publication.
- **Features**: `button/push` (power on, standby, play, pause, stop),
  read-only `unknown/binary` power and playing, `unknown/integer` chapter,
  `text/text` statuses, title, location and video format, `text/select`
  remote key. No switch, no unit.
- **Bounded input**: lines of 2 KB at most, 256 KB per session, fields
  parsed linearly (32 fields of 512 characters at most), values mapped
  through tables without prototype; only serial numbers are keys in `/data`.

## Development

```bash
npm install
npm test                                        # node --test, loopback only (fake player)
npm run lint && npm run format:check
npm run audit
npm run cover                                   # regenerates cover.png (800×534, no dependency)
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/fakePlayer.js` is a fake Kaleidescape player on 127.0.0.1
(after the emulator of pykaleidescape: answers, events, standby refusals,
slow, silent, closing or flooding players). The end-to-end tests run the
real handlers against the SDK's fake Gladys.

## Credits

- [`pykaleidescape`](https://github.com/SteveEasley/pykaleidescape) 1.2.0 by
  Steve Easley (MIT), the library behind the Home Assistant Kaleidescape
  integration: the protocol, message parsing, requests and value maps are
  ported from it to JavaScript.
- The app structure follows
  [LM1LC3N7/gladys-jvc-projector](https://github.com/LM1LC3N7/gladys-jvc-projector)
  and [LM1LC3N7/gladys-kef](https://github.com/LM1LC3N7/gladys-kef) (same
  author, Apache-2.0).

Kaleidescape is a trademark of its owner, used here only to name the
compatible products.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release.

## License

Apache-2.0, see [LICENSE](LICENSE). Third-party notices (pykaleidescape,
MIT): [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
