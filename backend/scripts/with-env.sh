#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: $0 <env-name> <command...>   (loads backend/.env.<env-name>)" >&2
  exit 1
fi

env_file="$(cd "$(dirname "$0")/.." && pwd)/.env.$1"
shift

if [ ! -f "$env_file" ]; then
  echo "missing $env_file" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

exec "$@"
