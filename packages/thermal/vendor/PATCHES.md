# Changes to the vendored libraries

The libraries under `vendor/` are imported from their releases by `scripts/sync.mjs` (versions, archives and sha-256 in
`vendor/UPSTREAM.json`). Any change made to them in lakutata is listed here, so that the next update can keep it (the
script merges a newer release with the changes made here).

None so far. The build settings that differ from the libraries' own builds are in `binding.gyp` and
`native/config/ftmodule.h` (the FreeType modules compiled), not in the vendored files.
