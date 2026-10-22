# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for Kaleidescape movie players
(local control protocol published by Kaleidescape, TCP 10000, no password):
a Node.js service (Node 22+, ESM, no build step) that runs in its own
sandboxed Docker container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.
See `TODO.md` for the status and the decisions.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "Standby" # tests whose name matches
npm run cover                             # regenerate cover.png (800×534)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: src/handlers.js registered before connect()
src/handlers.js                   the SDK handlers -> KaleidescapeApp (shared with the tests)
src/app.js                        KaleidescapeApp: known players, reads, commands, status
src/kaleidescape/client.js        one TCP session: requests with sequence numbers, bounded reads
src/kaleidescape/protocol.js      lines, escaped fields, value maps, remote keys (pure, ported)
src/model.js                      known players -> Gladys devices and states (pure)
src/publisher.js                  changed states only, within 240 states per minute
src/store.js                      /data/kaleidescape.json (players, time of the last reads)
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/constants.js, src/i18n.js     frozen keys, limits, timings; texts in English and French
scripts/cover.mjs                 cover.png generator (plain Node)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys and a fake player (loopback)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the serial
  number of the player (`DEVICE_INFO`, its last 12 characters zero-padded,
  lowercased), never its address or a label. The same goes for every key
  users store: manifest `config_schema`, `actions`, feature keys, remote key
  values. A device published again carries the full, fixed feature list:
  never remove a feature.
- **No switch.** Power on, Standby, Play, Pause, Stop are `button/push`; the
  power and playing states are read only. An "everything off" must never
  reach a player.
- **Commands**: validated before queueing; decided on the state read from
  the player just before, never on a state in memory; the line sent only
  before its deadline (checked just before the write); done only when a
  value read back equals the one asked; the answer to Gladys within the
  3.5 s budget, never waiting for a publication; "sent, without
  confirmation" when the line may have left, "nothing sent" otherwise.
  Standby, Pause and Stop are protective: outside the queue, never blocked
  by an unread state, they cancel the waking commands waiting.
- **Reads** are never sooner than the interval: not on `connected`, a
  configuration save, the check button, a device creation or a restart (the
  time of the last read is in `/data`, written before the read, at most once
  a minute). A late answer of an old configuration publishes nothing and
  sets no status (generation checked after every await).
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Nothing of what plays is stored there.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`.
  The catalog `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code: change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (loopback only).
- **Encoding.** Every file is UTF-8 without BOM; `test/encoding.test.js`
  refuses mojibake in the manifest, the docs and these files.
- **Untrusted input.** Everything the player sends is bounded, parsed once
  (linear) and mapped through fixed tables without prototype.
