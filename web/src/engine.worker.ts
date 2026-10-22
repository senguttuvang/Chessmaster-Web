/// <reference lib="webworker" />
type EngineModule = {
  FS: { writeFile(path: string, data: Uint8Array): void };
  callMain(args: string[]): void;
  inputRing?: SharedArrayBuffer;
};
self.onmessage = async (event: MessageEvent<{ ring: SharedArrayBuffer }>) => {
  try {
    const url = "/engine/theking.js";
    const { default: createEngine } = (await import(
      /* @vite-ignore */ url
    )) as {
      default: (options: Record<string, unknown>) => Promise<EngineModule>;
    };
    const response = await fetch("/engine/THEKING.EXE");
    if (!response.ok)
      throw new Error(`Engine image unavailable (${response.status})`);
    const module = await createEngine({
      noInitialRun: true,
      inputRing: event.data.ring,
      locateFile: (name: string) => "/engine/" + name,
      print: (line: string) =>
        self.postMessage(
          line === "__CM_ENGINE_READY__"
            ? { type: "ready" }
            : { type: "line", line },
        ),
      printErr: (line: string) =>
        self.postMessage({ type: "diagnostic", line }),
      onAbort: (reason: unknown) =>
        self.postMessage({ type: "error", message: String(reason) }),
      onExit: (code: number) =>
        self.postMessage({
          type: "error",
          message: `The engine stopped with exit code ${code}.`,
        }),
    });
    module.inputRing = event.data.ring;
    module.FS.writeFile(
      "/THEKING.EXE",
      new Uint8Array(await response.arrayBuffer()),
    );
    module.callMain(["/THEKING.EXE"]);
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
