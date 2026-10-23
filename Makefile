PY := .venv/bin/python
RUNTIME := vendor/cricket-recompiler/runtime
GEN := engine/generated
GHIDRA ?= /opt/homebrew/opt/ghidra/libexec
NATIVE_FLAGS := -O2 -Wno-parentheses-equality -frounding-math -pthread -I$(RUNTIME) -I$(GEN)

.PHONY: setup prepare-media analyze analyze-network translate native wasm check check-media dev
setup:
	uv sync --frozen
	bun install --frozen-lockfile
	mkdir -p build

# Source-only checkout: no original game content is downloaded or supplied.
prepare-media:
	bun tools/media.ts "$(GAME_DIR)"
	$(MAKE) analyze translate analyze-network

analyze-network:
	mkdir -p build/network-ghidra recovery/rooms
	JAVA_HOME="$(JAVA_HOME)" "$(GHIDRA)/support/analyzeHeadless" build/network-ghidra network -import "$(GAME_DIR)/MPGAME.DLL" -overwrite -analysisTimeoutPerFile 120 -scriptPath "$(CURDIR)/tools" -postScript ExportRoomNetwork.java "$(CURDIR)/recovery/rooms/mpgame.decompiled.c"
	bun tools/prepare_room_evidence.ts --network-analysis

analyze:
	mkdir -p build/ghidra engine/recovered
	$(PY) tools/normalize_pe.py
	JAVA_HOME="$(JAVA_HOME)" "$(GHIDRA)/support/analyzeHeadless" build/ghidra king -import build/THEKING.analysis.exe -overwrite -scriptPath "$(CURDIR)/vendor/cricket-recompiler/ghidra" -postScript ExportFunctions.java "$(CURDIR)/engine/functions.json"

translate:
	$(PY) vendor/cricket-recompiler/translator/x86toc.py vendor/original/THEKING.EXE engine/functions.json $(GEN) --all --per-file 100

native:
	mkdir -p build
	cc $(NATIVE_FLAGS) engine/host.c $(RUNTIME)/runtime.c $(RUNTIME)/interp.c $(GEN)/*.c -lm -o build/theking

wasm:
	mkdir -p web/public/engine
	emcc $(NATIVE_FLAGS) -DRC_BOUNDS engine/host.c $(RUNTIME)/runtime.c $(RUNTIME)/interp.c $(GEN)/*.c -lm -o web/public/engine/theking.js -sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=worker -sEXPORTED_RUNTIME_METHODS=FS,callMain -sEXPORTED_FUNCTIONS=_main -sINVOKE_RUN=0 -sFORCE_FILESYSTEM -sPTHREAD_POOL_SIZE=4 -sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=512MB -sMAXIMUM_MEMORY=768MB -sSTACK_SIZE=8MB -sDEFAULT_PTHREAD_STACK_SIZE=8MB
	cp vendor/original/THEKING.EXE web/public/engine/THEKING.EXE
	bun build web/src/engine.worker.ts --target browser --format esm --outfile web/public/engine-worker.js

# These checks run in a fresh checkout without game files.
check:
	mkdir -p build
	$(PY) -m unittest discover -s tests -p test_translation.py
	bun test ./tests/protocol.test.ts ./tests/database.test.ts ./tests/tournament.test.ts ./tests/replay.test.ts ./tests/release.test.ts
	bun run typecheck
	bun run build
	bun tools/release/check.ts

# Explicit integration suite; requires successful prepare-media and all original data.
check-media:
	$(MAKE) native wasm
	$(PY) -m unittest discover -s tests -p 'test_*.py'
	bun test ./tests/*.test.ts
	bun run typecheck
	bun run build
	bun run test:browser
	bun tools/release/check.ts

dev:
	bun run dev
