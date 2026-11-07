# Changes to the vendored libraries

The libraries under `vendor/` are imported from their releases by `scripts/sync.mjs` (versions, archives and sha-256 in
`vendor/UPSTREAM.json`). Any change made to them in lakutata is listed here, so that the next update can keep it (the
script merges a newer release with the changes made here).

The build settings that differ from the libraries' own builds are in `binding.gyp` and `native/config/ftmodule.h` (the
FreeType modules compiled), not in the vendored files.

## litehtml

- `include/litehtml/types.h`, `position::round()`: does nothing. litehtml rounds the positions it draws to whole CSS
  pixels (written for screens, where a CSS pixel is a screen pixel); a CSS pixel is about 2.1 dots of a 203 dpi printer,
  so the rounding moved the drawing by up to a dot, made the spaces between words uneven and opened one-dot gaps between
  adjacent table cells. The container (`native/Container.cpp`) snaps every position to the printer's dots instead.
