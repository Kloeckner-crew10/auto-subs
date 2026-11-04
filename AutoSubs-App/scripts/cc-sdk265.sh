#!/bin/zsh
# Linker wrapper: the installed Command Line Tools ship a macOS 27 SDK that
# their own ld cannot read. Rewrite rustc's SDK arguments to the 26.5 SDK.
args=()
for a in "$@"; do
  a=${a//MacOSX27.0.sdk/MacOSX26.5.sdk}
  a=${a//-platform_version,macos,13.3,27.0/-platform_version,macos,13.3,26.5}
  args+=("$a")
done
exec /usr/bin/cc "${args[@]}"
