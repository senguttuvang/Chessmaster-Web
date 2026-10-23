"""Build traced translated C, play one engine reply, quit and save instruction evidence.

This runs the existing native The King port, never the Windows graphical app.
Generated files go under build/. The runtime records at most its first 1M
instructions; the summary reports whether this capacity was reached.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def capture(timeout: float):
    build = ROOT / "build"
    generated = build / "trace"
    build.mkdir(exist_ok=True)
    subprocess.run([sys.executable, str(ROOT / "vendor/cricket-recompiler/translator/x86toc.py"),
                    "vendor/original/THEKING.EXE", "engine/functions.json", str(generated),
                    "--all", "--per-file", "100", "--trace"], cwd=ROOT, check=True)
    runtime = ROOT / "vendor/cricket-recompiler/runtime"
    binary = build / "theking-trace"
    subprocess.run(["cc", "-O1", "-Wno-parentheses-equality", "-frounding-math", "-pthread",
                    "-I" + str(runtime), "-I" + str(generated), "engine/host.c",
                    str(runtime / "runtime.c"), str(runtime / "interp.c"),
                    *map(str, sorted(generated.glob("*.c"))), "-lm", "-o", str(binary)],
                   cwd=ROOT, check=True)
    trace = build / "translated.trace"
    # A failed new run must never be mistaken for a previous successful capture.
    if trace.exists():
        trace.unlink()
    lines = []
    with (build / "trace-engine.stderr.log").open("wb") as errors:
        process = subprocess.Popen([str(binary), "vendor/original/THEKING.EXE"], cwd=ROOT,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors,
                                   env={**os.environ, "ENGINE_TRACE": "1", "ENGINE_TRACE_FILE": str(trace)})
        assert process.stdin is not None and process.stdout is not None
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        pending = b""

        def wait_line(prefix):
            nonlocal pending
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if b"\n" in pending:
                    row, pending = pending.split(b"\n", 1)
                    line = row.decode("utf-8", errors="replace").strip()
                    lines.append(line)
                    if line.startswith(prefix):
                        return line
                    continue
                if not selector.select(max(0, deadline - time.monotonic())):
                    break
                data = os.read(process.stdout.fileno(), 4096)
                if not data:
                    raise RuntimeError("Engine exited before expected output; inspect build/trace-engine.stderr.log")
                pending += data
            raise TimeoutError("Timed out waiting for " + prefix)

        try:
            wait_line("__CM_ENGINE_READY__")
            process.stdin.write(b"xboard\nnew\nforce\ncm_parm tts=16777216\nsd 2\nst 1\ne2e4\ngo\n")
            process.stdin.flush()
            reply = wait_line("move ")
            process.stdin.write(b"quit\n")
            process.stdin.flush()
            if process.wait(timeout=timeout) != 0:
                raise RuntimeError("Engine did not quit successfully")
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            process.stdin.close()
            process.stdout.close()
            selector.close()
    size = trace.stat().st_size
    if size == 0 or size % 36:
        raise RuntimeError("Missing or malformed instruction trace")
    summary = {"engineSha256": hashlib.sha256((ROOT / "vendor/original/THEKING.EXE").read_bytes()).hexdigest(),
               "engineReply": reply, "stdout": lines, "trace": "build/translated.trace",
               "records": size // 36, "capacityReached": size // 36 >= 1000000,
               "recordFormat": "little endian uint32: PC,EAX,ECX,EDX,EBX,ESP,EBP,ESI,EDI"}
    (build / "trace-engine.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=float, default=15)
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    print(json.dumps(capture(args.timeout), indent=2))
