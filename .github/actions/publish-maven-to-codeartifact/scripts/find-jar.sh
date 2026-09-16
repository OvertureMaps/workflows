#!/usr/bin/env bash
# Locates the built JAR to print the manifest for.
#
# Looks under WORKING_DIRECTORY/target by default, or
# WORKING_DIRECTORY/<first PROJECTS entry>/target when PROJECTS is set (a
# `-pl` build places its artifact under the module's own target/, not the
# root's). Prefers a `*-shaded.jar`, falls back to any `*.jar` at the top of
# that directory.
#
# Prints the resolved path on stdout and exits 0. When no JAR is found,
# prints nothing and warns on stderr instead of failing: not every module
# produces a fat JAR, and a missing JAR here isn't this action's problem to
# enforce.
set -euo pipefail

working_directory="${WORKING_DIRECTORY:-.}"
projects="${PROJECTS:-}"

target_dir="target"
if [ -n "$projects" ]; then
  target_dir="${projects%%,*}/target"
fi
target_dir="$working_directory/$target_dir"

jar_file=$(find "$target_dir" -name "*-shaded.jar" -print -quit 2>/dev/null || true)
if [ -z "$jar_file" ]; then
  jar_file=$(find "$target_dir" -maxdepth 1 -name "*.jar" -print -quit 2>/dev/null || true)
fi

if [ -z "$jar_file" ]; then
  echo "::warning::No JAR found in $target_dir; skipping manifest printout." >&2
  exit 0
fi

printf '%s\n' "$jar_file"
