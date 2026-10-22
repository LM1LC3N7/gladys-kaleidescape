# Kaleidescape for Gladys

Control your **Kaleidescape** movie players (Strato, Compact Terra Prevue,
Alto, Cinema One, M-Class) from Gladys, locally, without any cloud: power
on, standby, play, pause, stop, remote keys, play status, title, chapter,
movie location and video format.

> **Important.** This integration was never tested with a real device: it
> was written from the `pykaleidescape` library (the one of Home Assistant)
> and tested against a fake player only. Your feedback is welcome.
> Unofficial integration, not affiliated with Kaleidescape.

## Installation

1. Give the player a **fixed IP address** in your router (reserved DHCP
   lease).
2. In Gladys, install the **Kaleidescape** integration, open its
   configuration and type the IP addresses of the players, separated by
   commas (for example `192.168.1.60`; port 10000 by default, another one as
   `192.168.1.60:10001`).
3. The players appear in the **Discovery** tab: create them.

The control protocol has no password: nothing else to type. A server
without a movie zone (Terra, 1U, 3U) is not offered.

## What you get

| Feature        | Gladys type              | Note                                             |
| -------------- | ------------------------ | ------------------------------------------------ |
| Power          | binary state (read only) | 1 on, 0 standby or not reachable                 |
| Power status   | text (read only)         | On, Standby, Not reachable                       |
| Power on       | button                   | sent from standby only                           |
| Standby        | button                   | sent when on only; never blocked                 |
| Play           | button                   | sent when on only                                |
| Pause, Stop    | buttons                  | sent only when a movie plays; never blocked      |
| Remote key     | dropdown                 | arrows, OK, Back, menu, next / previous chapter… |
| Playing        | binary state (read only) | 1 while playing (or scanning)                    |
| Play status    | text (read only)         | Idle, Paused, Playing, Fast forward, Rewind      |
| Title          | text (read only)         | the title playing, "No title" when nothing plays |
| Chapter        | number (read only)       | 0 when nothing plays                             |
| Movie location | text (read only)         | None, Content, Intermission, Credits, Disc menu  |
| Video mode     | text (read only)         | for example `3840x2160p24 16:9`                  |
| Dynamic range  | text (read only)         | SDR, HDR, HDR10 (PQ), Unknown                    |

On purpose, no **switch**: an "everything off" or "everything on" of a voice
assistant or a scene never reaches your player. Use the buttons in your
scenes. Example: dim the lights when "Playing" turns 1, light them again
when "Movie location" becomes "Credits".

## Commands

The state of the player (its serial number, power and play status) is read
again just before every command. When another player answers at the
address, nothing is sent and the address is forgotten; an unreadable serial
number does not count as another player.

- **Power on** is sent from standby only; **Play** and the **remote keys**
  only when the player is on (otherwise: refused, nothing sent). These
  commands go one at a time.
- **Standby**, **Pause** and **Stop** are protective: they never wait in the
  queue, are never refused because the state could not be read (they are
  sent anyway), and they cancel the Power on, Play or remote key commands
  still waiting ("Cancelled by …, nothing sent").
- A command is answered as done only when the state read afterwards is the
  one asked (power, playing, paused, stopped); a remote key, when the player
  accepts it. Otherwise: "Sent, without confirmation from the player". A
  command that could not leave says "nothing sent", a refusal of the player
  "refused by the player".

Every command is answered within 4 seconds (Gladys waits 5 seconds); it
never leaves after its deadline.

## Configuration button

- **Check the players**: tells the known state of each player and each
  typed address, with the age of the last read. It reads a player again only
  when its interval has passed.

## Refresh, status and limits

- The state of each player is read every 15 seconds by default (10 to 300),
  in one short connection. Never more often: neither the reconnection to
  Gladys, nor a configuration save, nor the button, nor the creation of the
  device, nor a restart reads sooner (the time of the last read is kept in
  the data folder).
- An address where no player is identified yet is read every minute at
  most.
- A player that does not answer shows power 0 and "Not reachable", and is
  named in the status of the integration.
- The title, chapter and video format are read at each refresh: a scene
  reacts with that delay (no real-time events yet).

## Data and privacy

The integration keeps in `/data/kaleidescape.json` the known players
(serial number, address, port, model, name, number of movie zones) and the
time of the last read of each address. Nothing of what you watch is written
there. Nothing leaves your local network.

## Known limits

- No real-time events yet (reads at each interval only).
- No cover art, synopsis nor volume control (the player does not drive the
  volume).
- A player with several zones is seen as one device (main zone).
- Never tested with a real device: real answers may differ.
