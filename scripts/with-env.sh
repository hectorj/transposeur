#!/usr/bin/env bash
#
# Runs a command with .env.local loaded into its environment.
#
# The values are never echoed: no `set -x`, nothing is printed, and the file is
# sourced rather than interpolated into a command line, so the secrets stay out
# of the shell history and out of the process list.
#
#   ./scripts/with-env.sh web-ext sign ...
#
set -euo pipefail

env_file="${ENV_FILE:-.env.local}"

if [ ! -f "$env_file" ]; then
  echo "with-env: $env_file not found" >&2
  echo "with-env: expected WEB_EXT_API_KEY and WEB_EXT_API_SECRET from the AMO developer hub" >&2
  exit 1
fi

perms=$(stat -c '%a' "$env_file" 2>/dev/null || stat -f '%Lp' "$env_file")
case "$perms" in
  *[2367]) echo "with-env: $env_file is group/world readable ($perms); run chmod 600 on it" >&2 ;;
esac

set -a
# shellcheck source=/dev/null
. "$env_file"
set +a

exec "$@"
