#!/bin/sh
set -eu

bbbbb check
exec bbbbb run -- "$@"
