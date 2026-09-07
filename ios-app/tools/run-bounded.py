#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Bound a macOS build/test command and terminate its process group on timeout."""
import os
import signal
import subprocess
import sys

limit=int(sys.argv[1])
command=sys.argv[2:]
process=subprocess.Popen(command,start_new_session=True)
try:
    sys.exit(process.wait(timeout=limit))
except subprocess.TimeoutExpired:
    print(f'COMMAND_TIMEOUT after {limit}s: {command[0]}',flush=True)
    os.killpg(process.pid,signal.SIGTERM)
    try: process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid,signal.SIGKILL)
        process.wait()
    sys.exit(124)
