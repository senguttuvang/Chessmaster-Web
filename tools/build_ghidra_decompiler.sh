#!/bin/sh
# Build Ghidra's ARM64 decompiler into this checkout; installation is separate.
set -eu

if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo 'This procedure targets macOS ARM64. Other platforms should use Ghidra native build instructions.' >&2
  exit 1
fi

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ghidra_home=${1:-/opt/homebrew/opt/ghidra/libexec}
source_dir="$ghidra_home/Ghidra/Features/Decompiler/src/decompile/cpp"
build_dir="$project_root/build/ghidra-decompiler"
if [ ! -f "$source_dir/Makefile" ]; then
  echo "Missing Ghidra shipped decompiler sources: $source_dir" >&2
  exit 1
fi
mkdir -p "$build_dir"
cp -R "$source_dir/." "$build_dir/"
make -C "$build_dir" -j4 ghidra_opt ARCH_TYPE='-arch arm64' ADDITIONAL_FLAGS='-w' OSDIR=mac_arm_64
binary="$build_dir/ghidra_opt"
test -x "$binary"
echo "Built: $binary"
echo "To install for this Ghidra distribution:"
echo "  mkdir -p '$ghidra_home/Ghidra/Features/Decompiler/os/mac_arm_64'"
echo "  cp '$binary' '$ghidra_home/Ghidra/Features/Decompiler/os/mac_arm_64/decompile'"
echo 'Run make analyze afterward to verify actual decompilation succeeds.'
