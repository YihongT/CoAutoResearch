#!/usr/bin/env python3
"""Run an experiment with durable exit evidence and an external wall deadline."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


# Keep the group leader alive until cleanup. This pins the process-group ID
# while signals are sent, without requiring a sandbox-forbidden process table.
POSIX_WORKER = r"""
import os, select, signal, sys
signal.signal(signal.SIGTERM, signal.SIG_IGN)
descriptor = int(sys.argv[1])
child = os.fork()
if child == 0:
    os.close(descriptor)
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    signal.signal(signal.SIGINT, signal.SIG_DFL)
    null = os.open(os.devnull, os.O_RDONLY)
    os.dup2(null, 0)
    os.close(null)
    try:
        os.execvpe(sys.argv[2], sys.argv[2:], os.environ)
    except OSError as exc:
        print(str(exc), file=sys.stderr, flush=True)
        os._exit(127)
finished = False
while True:
    if not finished:
        pid, status = os.waitpid(child, os.WNOHANG)
        if pid:
            os.write(descriptor, (str(os.waitstatus_to_exitcode(status)) + "\n").encode())
            os.close(descriptor)
            finished = True
    readable, _, _ = select.select([0], [], [], .02)
    if readable and not os.read(0, 1):
        os.killpg(os.getpgrp(), signal.SIGKILL)
"""


class PosixWorker:
    def __init__(self, command, stdout, stderr):
        self.exit_code = None
        self.buffer = b""
        self.read_fd, write_fd = os.pipe()
        try:
            self.process = subprocess.Popen(
                [sys.executable, "-B", "-c", POSIX_WORKER, str(write_fd), *command],
                stdin=subprocess.PIPE, stdout=stdout, stderr=stderr,
                pass_fds=(write_fd,), start_new_session=True,
            )
        except BaseException:
            os.close(self.read_fd)
            raise
        finally:
            os.close(write_fd)
        os.set_blocking(self.read_fd, False)
        self.pid = self.process.pid

    def poll(self):
        if self.exit_code is not None:
            return self.exit_code
        try:
            self.buffer += os.read(self.read_fd, 64)
        except BlockingIOError:
            pass
        if b"\n" in self.buffer:
            self.exit_code = int(self.buffer.split(b"\n", 1)[0])
        elif self.process.poll() is not None:
            raise RuntimeError("Experiment group leader exited before recording the worker's status.")
        return self.exit_code

    def wait(self, timeout):
        deadline = time.monotonic() + timeout
        while self.poll() is None:
            if time.monotonic() >= deadline:
                raise subprocess.TimeoutExpired("experiment worker", timeout)
            time.sleep(.01)
        return self.exit_code

    def drain(self):
        try:
            if self.process.poll() is not None:
                raise RuntimeError("Experiment group leader was lost; cleanup cannot be verified.")
            os.killpg(self.pid, signal.SIGTERM)
            time.sleep(.2)
            self.poll()
            if self.process.poll() is not None:
                raise RuntimeError("Experiment group leader was lost during cleanup.")
            # Never send another signal after reaping this owned group leader:
            # a subsequently reused numeric ID must not receive our signals.
            os.killpg(self.pid, signal.SIGKILL)
            self.process.wait(timeout=3)
            deadline = time.monotonic() + 3
            while True:
                try:
                    os.killpg(self.pid, 0)
                except ProcessLookupError:
                    break
                if time.monotonic() >= deadline:
                    raise RuntimeError("Experiment process group did not drain after termination.")
                time.sleep(.02)
        finally:
            os.close(self.read_fd)
            self.process.stdin.close()


def spawn_worker(command, stdout, stderr):
    if os.name == "posix":
        return PosixWorker(command, stdout, stderr)
    from server import spawn_agent_process
    return spawn_agent_process(command, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr)


def drain_worker(proc):
    if isinstance(proc, PosixWorker):
        proc.drain()
        return proc.exit_code
    from server import drain_agent_process_tree
    drain_agent_process_tree(proc)
    return proc.poll()


def positive_seconds(value: str) -> float:
    seconds = float(value)
    if not math.isfinite(seconds) or seconds <= 0:
        raise argparse.ArgumentTypeError("wall seconds must be finite and positive")
    return seconds


def run(command: list[str], output_dir: Path, wall_seconds: float) -> dict:
    """Never overwrite an earlier run; a zero exit is successful only after cleanup."""
    output_dir.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    stop_signal = None
    proc = None
    result = {"status": "launch_failed", "exit_code": None, "terminating_signal": None,
              "cleanup_complete": False,
              "cleanup_scope": "process_group" if os.name == "posix" else "job"}
    previous_handlers = {}

    def request_stop(signum, _frame):
        nonlocal stop_signal
        stop_signal = signum

    with (output_dir / "events.jsonl").open("x", encoding="utf-8") as events:
        def record(event, **details):
            events.write(json.dumps({"event": event, "elapsed_seconds": time.monotonic() - started,
                                     **details}, ensure_ascii=False) + "\n")
            events.flush()
            os.fsync(events.fileno())

        try:
            for signum in (signal.SIGINT, signal.SIGTERM):
                previous_handlers[signum] = signal.signal(signum, request_stop)
            record("execution_start", command=command, wall_seconds=wall_seconds,
                   budget_kind="wall_time", cwd=str(Path.cwd()))
            with (output_dir / "stdout.log").open("xb") as stdout, (output_dir / "stderr.log").open("xb") as stderr:
                if stop_signal is None:
                    proc = spawn_worker(command, stdout, stderr)
                    record("worker_started", pid=proc.pid)
                    while proc.poll() is None and stop_signal is None:
                        remaining = wall_seconds - (time.monotonic() - started)
                        if remaining <= 0:
                            result["status"] = "timed_out"
                            break
                        try:
                            proc.wait(timeout=min(0.1, remaining))
                        except subprocess.TimeoutExpired:
                            pass
                if stop_signal is not None:
                    result["status"] = "interrupted"
                    result["supervisor_signal"] = signal.Signals(stop_signal).name
                elif result["status"] != "timed_out":
                    code = proc.poll()
                    result["status"] = "succeeded" if code == 0 else "signal_terminated" if code < 0 else "failed"
        except Exception as exc:
            result["error"] = str(exc)
            result["status"] = "supervisor_failed" if proc is not None else "launch_failed"
        finally:
            try:
                if proc is not None:
                    drain_worker(proc)
                result["cleanup_complete"] = True
            except Exception as exc:
                result["status"] = "cleanup_failed"
                result["error"] = str(exc)
            finally:
                if proc is not None:
                    # Preserve the worker's independently recorded exit even if
                    # cleanup fails. The POSIX leader's exit is not the worker's.
                    result["exit_code"] = proc.exit_code if isinstance(proc, PosixWorker) else proc.returncode
                    if os.name != "nt" and result["exit_code"] is not None and result["exit_code"] < 0:
                        number = -result["exit_code"]
                        try:
                            result["terminating_signal"] = signal.Signals(number).name
                        except ValueError:
                            result["terminating_signal"] = f"signal {number}"
                for signum, previous in previous_handlers.items():
                    signal.signal(signum, previous)
            record("execution_finished", **result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wall-seconds", type=positive_seconds, required=True,
                        help="External wall deadline; does not enforce an aggregate CPU budget.")
    parser.add_argument("--output-dir", type=Path, required=True,
                        help="Nonexistent evidence directory, created by this runner. Do not pre-create it; existing directories are never overwritten.")
    parser.add_argument("command", nargs=argparse.REMAINDER, help="-- executable arguments...")
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("provide a worker command after --")
    try:
        result = run(command, args.output_dir, args.wall_seconds)
    except FileExistsError as exc:
        parser.exit(1, f"Cannot create execution evidence: {exc}\n"
                    "The evidence directory already exists. The runner creates --output-dir; "
                    "choose a new path and do not create it beforehand. The worker was not started.\n")
    except OSError as exc:
        parser.exit(1, f"Cannot create execution evidence: {exc}\n")
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return 0 if result["status"] == "succeeded" else 124 if result["status"] == "timed_out" else 1


if __name__ == "__main__":
    raise SystemExit(main())
