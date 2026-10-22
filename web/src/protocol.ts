export const RING_SIZE = 65536;
export function sendCommand(ring: SharedArrayBuffer, command: string): void {
  if (command.includes('\0')) throw new Error('Invalid engine command');
  const state = new Int32Array(ring, 0, 4), bytes = new Uint8Array(ring, 16);
  const data = new TextEncoder().encode(command + '\n');
  const read = Atomics.load(state, 0), write = Atomics.load(state, 1);
  const free = (read - write - 1 + bytes.length) % bytes.length;
  if (data.length > free) throw new Error('Engine input queue is full');
  for (let i = 0; i < data.length; i++) bytes[(write + i) % bytes.length] = data[i];
  Atomics.store(state, 1, (write + data.length) % bytes.length);
  Atomics.notify(state, 1);
}
export function engineMove(line: string): string | null {
  const match = /^(?:move\s+|\d+\.\s*\.\.\.\s*)([a-h][1-8][a-h][1-8][qrbn]?)(?:\s|$)/i.exec(line.trim());
  return match?.[1].toLowerCase() ?? null;
}
