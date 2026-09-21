#!/usr/bin/env python3
"""Compatibility entry point: build 6 was rejected; submit the fixed release."""
from pathlib import Path
import runpy

if __name__ == '__main__':
    print('Build 6 was rejected by Apple. Using the replacement in config/testflight-release.json.')
    runpy.run_path(str(Path(__file__).with_name('submit-testflight.py')), run_name='__main__')
