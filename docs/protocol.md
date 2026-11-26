# Phone ↔ machine commands (draft)

The phone decides everything. The ESP32 only runs motors and reports its sensor. Commands are
short text lines over Bluetooth LE. Not implemented yet; names and details may change.

| Phone sends | Machine does | Machine answers |
|---|---|---|
| `FEED` | Runs the feeder until the IR sensor sees a card on the platform | `ARRIVED`, or `JAM` if no card shows up in time (also when the stack is empty) |
| `EJECT 1` / `EJECT 2` / `EJECT 3` / `EJECT R` | Spins the matching wheel in the matching direction | `DONE` |
| `STOP` | Stops all motors | `DONE` |

One card:

1. `FEED` → `ARRIVED`
2. The phone takes a photo, reads the card and picks the bin.
3. `EJECT n` → `DONE`
4. The phone checks that the platform is empty, then starts again.

Only one motor runs at a time.
