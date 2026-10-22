# Third-party notices

This integration ports to JavaScript the logic of the following project: the
Kaleidescape control protocol (TCP 10000: request lines with a sequence
number, the parsing of the answers and events with their escaped fields, the
error statuses), the requests read and sent (device information, zones,
power, play status, title, movie location, video mode and color, standby,
playback and navigation commands) and the value maps of the answers
(`src/kaleidescape/`). Nothing of it is installed at runtime; its notice is
reproduced below.

## pykaleidescape 1.2.0

<https://github.com/SteveEasley/pykaleidescape> (the library behind the Home
Assistant Kaleidescape integration), version 1.2.0 of 2026-10-11 (commit
`50df2869349667d1e68d429b9b619e32ede9879b`)

```
MIT License

Copyright (c) 2021 Steve Easley

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## LM1LC3N7/gladys-jvc-projector and LM1LC3N7/gladys-kef

The structure of the app, the `/data` store, the command budget, the state
publisher (300 states per minute) and the handler wiring follow integrations
of the same author, under the Apache License 2.0 of this repository.
