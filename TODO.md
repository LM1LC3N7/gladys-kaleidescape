# TODO — Kaleidescape v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm audit --omit=dev`,
  `npx github:GladysAssistant/integration-store .`, then update README,
  `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only.

## Status

- [x] **Milestone 1 — local control** (2026-10-22): players added by IP
      address, identified by serial number; one short TCP session per read
      and per command; power, Power on / Standby / Play / Pause / Stop
      buttons, remote keys, playing, play status, title, chapter, movie
      location, video mode, dynamic range; "Check the players" button; docs
      en/fr. Tested against a fake player on the loopback interface only,
      never with a real device. The store validator could not be run from the
      development session (no access to it there): to run before the first
      release.
- [ ] **Milestone 2 — real players** (testers with a Strato, Alto, Cinema
      One or M-Class). To check first:
  - which requests answer in standby (`GET_DEVICE_INFO`, `GET_NUM_ZONES`,
    `GET_FRIENDLY_NAME`; the fake answers them, the player may refuse with
    status 20);
  - how long `LEAVE_STANDBY` takes before `DEVICE_POWER_STATE` says on (the
    command is "sent, without confirmation" when it takes more than ~3 s);
  - `PLAY` with nothing loaded (status 0 stays: "sent, without
    confirmation" today);
  - the rendering on the Gladys dashboard (not checked here) of the
    `unknown/integer` chapter and the `text/text` states.
- [ ] **Milestone 3 — more**: real-time events on a kept connection (the
      player pushes `PLAY_STATUS`, `MOVIE_LOCATION`, `VIDEO_MODE`... with
      `!`), scene triggers (credits, intermission) through
      `publishSceneEvent`, cover art (`GET_CONTENT_DETAILS`), one device per
      zone of multi-zone players, network discovery.
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, then the store validator once the image is published.

## Decisions

- Forum: no dedicated topic, no post from this module's work; one recap per
  wave in /t/10385, posted by the main session.
- Reuse: SteveEasley/pykaleidescape 1.2.0 (MIT, version of 2026-10-11, commit
  `50df286`, the library of the Home Assistant Kaleidescape integration;
  LICENSE file read: MIT, copyright 2021 Steve Easley) is Python (asyncio),
  so its protocol (connection.py), message parsing and value maps
  (message.py, const.py) and requests (device.py) are ported to JavaScript
  (`src/kaleidescape/`); MIT notice in `THIRD_PARTY_NOTICES.md`, copied into
  the image. Its `SEND_TO_SYSLOG` self-identification at connection is not
  ported (nothing written to the player's log). No runtime dependency
  besides the SDK (`node:net`).
- Neighbour modules: LM1LC3N7/gladys-jvc-projector (structure, sessions,
  buttons, store, fake device on loopback) and LM1LC3N7/gladys-kef (state
  publisher within 300 states / min, attempt times in `/data`), read only.
- Version 0.1.0 in `package.json`, `package-lock.json`, the manifest and the
  `docker_image` tag, set by hand at milestone 1: the one exception to
  "versions belong to the Release workflow", because the template's 1.0.0 and
  its image were someone else's. The first patch release gives 0.1.1.
- External ids: `gladys.externalIds('player', <serial>)`, the serial number
  of `DEVICE_INFO` (second field), its last 12 characters zero-padded and
  lowercased (pykaleidescape's rule; Home Assistant uses it as unique id),
  never the address. All zeros or unreadable: no identity (a new address is
  tried again a minute later). Feature keys are frozen: `power`,
  `power_status`, `power_on`, `standby`, `play`, `pause`, `stop`,
  `remote_key`, `playing`, `play_status`, `title`, `chapter`,
  `movie_location`, `video_mode`, `dynamic_range`; remote key values too.
  Every publication carries the full, fixed feature list.
- **No switch** (lesson of lot 6): Power on, Standby, Play, Pause, Stop are
  `button/push`; power and playing are `unknown/binary` read only.
- Commands: validated before anything is queued or sent (an unknown remote
  key opens no connection). Budget 3.5 s from the Gladys request; the line
  leaves only while `deadline - 200 ms` is not passed (checked in
  `beforeWrite`, just before the write, after the state read and any slow
  connection). Done only when a value read back equals the one asked (power
  on / standby, playing, paused, stopped), read again every 250 ms until the
  deadline; a remote key changes no state: the player's acceptance (status 000) confirms it. A line that left without that is "Sent, without
  confirmation from the player"; a refusal of the player (error status) is
  told as such; otherwise "nothing sent". The ack never waits for the
  publication of the states (published in the background).
- Waking commands (Power on, Play, remote keys) are queued per player, one
  at a time, and decided on the state read just before (serial number,
  power, play status): Power on from standby only, Play and keys when on
  only; an unread power refuses them ("nothing sent").
- Protective commands (Standby, Pause, Stop): outside the queue (the player
  takes several connections), never refused because the state could not be
  read (then sent anyway, in a new session if the read broke the first
  one); nothing sent only when the state read says it is already done,
  when another player answers at the address, or when no session opens in
  time. Each bumps an epoch per player: the waking commands waiting are
  rejected at once ("Cancelled by stop, nothing sent"), and a running one
  checks the epoch just before its line leaves. No 429/5xx pause exists
  here (local protocol), so nothing can block them.
- Identity: the serial number is read at every read and before every
  command. Only a valid, different serial number proves another player (the
  old one's address is forgotten, "Not reachable", the status says "Address
  unknown"; a command then sends nothing). An unreadable or refused
  `DEVICE_INFO` is no other player: the reading stays the known player's,
  and commands go on. After a restart, the players (serial, address) are in
  `/data`, so Standby works before the first read.
- Reads: `poll_interval` 10..300 s (15 by default); one read per address
  and interval, a minute at least for an address without an identified
  player. A 1 s scheduler starts the due ones. The time of the attempt is set
  before the session and written to `/data` before it when the last write is
  a minute old or more; at start, a time found in `/data` less than a minute
  plus an interval old waits a whole interval. `connected`, a configuration
  save (unchanged or not), "Check the players", a device creation or a
  restart never read sooner. A read joins the running one of its address.
  Each read checks the generation (bumped by a change of addresses and by
  stop) and the link after every await: a late answer publishes nothing and
  sets no status. Power is the only required value; a secondary one that
  fails is left out (what was published stays). Name, model and zones are
  read for a new player, then once an hour.
- Status and Discovery: published again at every `connected` (status cache
  and published states forgotten), the states from memory. A local
  integration: `connected: true`, with notes (invalid entries, addresses
  without a player, servers without a movie zone, address unknown, not
  reachable, `/data` reset).
- States: only the changed values, through one sliding one-minute window of
  240 states shared by every caller (POST /state admits 300), power and
  playing first, the title last. Text states in English (one language per
  state, translated in docs/fr.md). In standby: playing 0, "Idle", "No
  title", chapter 0, location and video mode "None". No unit is used (no
  numeric feature has one in the core).
- Hostile input: lines of 2 KB at most (else the session is closed), 256 KB
  per session (an event flood closes it), each chunk scanned once, each line
  parsed once left to right (32 fields of 512 characters at most, `\dNNN`
  checked), answers matched on device `01` and the sequence number, values
  mapped through frozen tables without prototype (`Object.hasOwn`), texts
  cleaned of control characters and cut (title 100, name 60). `/data` keys
  are serial numbers and address keys only, sanitized at load; attempt
  times read back are capped to now.
- No secret: the control protocol has no password, the manifest has no
  `secret` field.
- No network discovery: Kaleidescape players are found by Home Assistant
  through SSDP/UPnP in its own integration flow, not in pykaleidescape; the
  addresses are typed.
- (Review 1, 2026-10-22) Fixes:
  - B1 / M6: a guard per player, set in `beforeWrite` when a confirmed
    command line leaves (`{ kind, expect, until }`), lifted only by a value
    read back equal to the one asked (any read or command read back), or
    after 60 s (LEAVE_STANDBY, ENTER_STANDBY) / 20 s (PLAY, PAUSE, STOP).
    While a waking line is guarded, Standby / Pause / Stop never take the
    "already done" shortcut (the line goes); while a protective line is
    guarded, Power on / Play never take "already on / playing".
  - I1: an answer is taken only with its expected name (`ANSWERS` for a
    GET\_, none for a command acknowledgement); an error status is still an
    answer. Another name on the same sequence is dropped.
  - I2: a protective command of the same key already running for the
    player is joined (same answer, never delayed, no session more); the
    waking queue holds 4 commands, more are refused at once ("Player busy,
    nothing sent").
  - M1: Play is "already done" only during a plain playback (a scan or
    rewind gets PLAY). M2: a link removed from the configuration is kept
    aside with its last read (and a read in flight), its attempt time kept
    6 minutes. M3: the publisher remembers a value before the request,
    forgets it on failure. M4: a failing getDevices is tried again after
    30 s, doubled up to 5 minutes; its return syncs the links and the
    states. M5: the second (blind) session of a protective command reads
    `DEVICE_INFO` again (softly). M7: a full player table evicts a player
    never created (one without address first). M8: `stop()` always writes
    `/data`; the partial line goes to one fixed 2 KB buffer. The isolated
    Node 22 failure of the review was not reproduced (4 runs Node 22, 3
    runs Node 24, all green).
