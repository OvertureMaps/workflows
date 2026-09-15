#!/usr/bin/env bash

summary_cell() {
  local value="$1"
  value="${value//&/\&amp;}"
  value="${value//</\&lt;}"
  value="${value//>/\&gt;}"
  value="${value//|/\&#124;}"
  value="${value//\`/\&#96;}"
  value="${value//$'\r'/ }"
  value="${value//$'\n'/ }"
  printf '%s' "$value"
}

finish_publish() {
  local status=$?
  trap - EXIT
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    local result="$publish_result" package_size="Not measured"
    if [ -n "$size" ]; then
      package_size="$size bytes"
    fi
    if [ "$status" -ne 0 ]; then
      result="Failed: $stage"
      if [ "$stage" = "Verify release tag" ]; then
        tag_result="Failed"
      fi
    fi
    if ! printf '\n### Crate publishing\n\n| Field | Value |\n| --- | --- |\n| Crate | %s |\n| Version | %s |\n| Release-tag check | %s |\n| Package size | %s |\n| Size limit | %s bytes |\n| Result | %s |\n' \
      "$(summary_cell "${CRATE_NAME:-Unavailable}")" \
      "$(summary_cell "${CRATE_VERSION:-Unavailable}")" \
      "$tag_result" \
      "$package_size" \
      "$(summary_cell "$MAX_BYTES")" \
      "$result" >> "$GITHUB_STEP_SUMMARY"; then
      echo "::warning::Could not write crate publishing job summary" >&2
    fi
  fi
  exit "$status"
}
