#!/bin/sh
set -eu

exec bbbbb run -- ./long-task "$@"
