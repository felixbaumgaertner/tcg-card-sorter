# Plan

Decisions so far. Sizes and parts are first guesses until the tests below are done.

## Done means (v1)

Two runs of 50 mixed English Riftbound cards. Each card is recognised and dropped into the
right bin, following a preset picked on the phone. At least 95 % correct, no jams.

Not in v1: rarity or value sorting, a collection manager, other games, speed, other phones.

## Machine ("spit-out" design)

- **Feeder:** the stack lies flat, a rubber roller under it pulls out the bottom card, a gate
  with an adjustable gap lets only one card through.
- **Scan platform:** smaller than a card, so the card hangs over on every side.
- **Ejector:** two crossed omni wheels under the platform. One throws the card left or right,
  the other to the front or back. The card slides down a short slope into a fixed bin. The
  wheels also hold the card still for the photo.
- **Bins:** three sort bins (left, front, right) and a reject bin under the feeder.
- **Phone shelf:** four posts, phone screen up, camera looking down from about 110 mm.
- **Electronics:** ESP32, three N20 gear motors, two DRV8833 drivers, one IR sensor, power
  over USB-C at 5 V.
- **Size:** about 230 × 300 × 170 mm.

Fallback if the wheels don't grip: a short chute that turns to four fixed directions.

Concept drawings: `docs/concept/` (HTML fragments made for a page viewer; they have no
`<html>` wrapper).

## App

- A PWA: static files on a free page host, installable, offline after the first open.
- Reads the printed code with Tesseract.js. If that fails, reads the card name. If both fail,
  the card goes to the reject bin.
- Fallback if Tesseract is not good enough: wrap the same code with Capacitor and use ML Kit.
- Talks to the machine over Web Bluetooth. Android only (Chrome, Edge, Samsung Internet).
- Camera, text reader and machine link each sit behind a small interface. A "fake machine"
  lets the whole app run with no hardware.
- Presets: by set · by set and exact number · by domain.
- Order inside a set: normal cards by number, then alternate art, overnumbered, signature,
  runes and specials at the end.
- Every run is saved on the phone (one row per scanned card) and can be exported as CSV.
  Photos are not kept.
- A sort that takes several rounds can be paused and resumed.
- Screens: Home, Run, Restack, Result, History, plus a debug switch.

## Rounds needed (3 sort bins)

| Preset | Rounds |
|---|---|
| By set | 1 (more if the stack holds more than 3 sets) |
| By domain | 2 |
| By set and exact number | 1 scan round, then 1 round per ×3 of different cards (9 → 2, 27 → 3, 81 → 4) |

The feeder takes from the bottom and the bins fill from the top, so a bin keeps its order.
Sorting in rounds depends on that.

## Tests that decide open questions

| Test | Decides |
|---|---|
| ~50 phone photos of cards, read with Tesseract.js (pass: 48 of 50) | PWA only, or Capacitor fallback |
| One motor, one omni wheel, a ball on top: throw 20 cards | Spit-out design, or the turning chute |
| Feeder test rig: 200 cards, no doubles, no jams | Feeder design |

## Open questions

- How the printed code looks on each kind of card, and whether promo printings can be told
  from the normal ones by the code alone.
- Number of bins (4 is the working assumption).
- Lens position and closest focus of the phone.

## Build order for the software

1. Card list ✔
2. Reading: photo → code or name → card
3. Sort planner: preset + scanned cards → bin for every card, for every round
4. App screens with the fake machine
5. Firmware
6. Connect the app to the real machine
