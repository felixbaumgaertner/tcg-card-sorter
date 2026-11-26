# tcg-card-sorter (working name)

A small, portable machine that sorts **Riftbound** trading cards. A phone lies on top, reads
each card with its camera and tells the machine which bin the card goes to.

> **Status: planning and setup.** No machine exists yet and the app sorts nothing. What works
> today is the built-in card list and the project skeleton.

## The idea

- **Phone = camera and brain.** A web app (PWA) reads the code printed on each card, decides
  the bin and saves the run. It works offline once installed.
- **Machine = feeder, two wheels, bins.** An ESP32 runs three small motors and one sensor. It
  only follows orders from the phone over Bluetooth.
- **Few bins, several rounds.** Three sort bins and one reject bin. An exact sort by set and
  number takes a few rounds through the machine.

Details: [docs/plan.md](docs/plan.md) · phone ↔ machine commands: [docs/protocol.md](docs/protocol.md)

## Layout

| Folder | What it holds |
|---|---|
| `app/` | The phone app: SvelteKit + TypeScript, built as static files |
| `firmware/` | ESP32 code (PlatformIO). Not started |
| `model/` | Printable parts. Not started |
| `docs/` | Plan, protocol, concept drawings |

## Working on the app

Needs Node 22 or newer.

```sh
cd app
npm install
npm run dev      # start the app locally
npm test         # unit tests
npm run check    # type check
npm run build    # static files in app/build
npm run cards    # refresh the built-in card list from Riftcodex
```

## Reader test page

`/ocr-test` is a throwaway page for one question: can a phone browser read the small code on a
card, and how fast? It runs PaddleOCR (PP-OCRv4) through ONNX Runtime Web, all on the device.
On 11 hand-held test photos it read 11 of 11 codes on a laptop; Tesseract.js read 7.

## Card data

The card list (names, numbers, sets, domains; text only, no images) comes from the
[Riftcodex](https://riftcodex.com) API and is stored in `app/src/lib/data/cards.json`.

## License

GPL-3.0-or-later, see [LICENSE](LICENSE).

tcg-card-sorter was created under Riot Games' "Legal Jibber Jabber" policy using assets owned
by Riot Games. Riot Games does not endorse or sponsor this project.
