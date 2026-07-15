# Bundle ENABLED pi extensions into the binary and compile it.
#
# Extension selection is driven by `pi list` (the same source of truth pi
# uses): an extension reported as `(filtered)` is DISABLED and skipped.
# Only enabled, installed extensions are embedded. File-based extensions not
# managed by `pi install` are intentionally excluded.
#
# To bundle additional dirs on top of the enabled set, pass --discover:
#   just bundle -- --discover /path/to/extensions
#
# Output: packages/coding-agent/dist/pi
bundle extra_args="":
    cd packages/coding-agent && node scripts/build-bundled-binary.mjs --compile {{extra_args}}
