#!/bin/zsh
cd -- "${0:A:h:h}" || exit 1
python3 scripts/read-settlement-configuration.py
read -r '?Press Return to close this diagnostic session.'
