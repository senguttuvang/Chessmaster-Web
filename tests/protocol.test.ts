import { expect, test } from "bun:test";
import { sendCommand, engineMove } from "../web/src/protocol";

test("commands wrap without overwriting unread input", () => {
  const ring = new SharedArrayBuffer(24),
    state = new Int32Array(ring, 0, 4),
    bytes = new Uint8Array(ring, 16);
  state[0] = 5;
  state[1] = 6;
  bytes[5] = 42;
  sendCommand(ring, "go");
  expect([...bytes.slice(6), bytes[0]]).toEqual([103, 111, 10]);
  expect(state[1]).toBe(1);
  expect(bytes[5]).toBe(42);
  expect(() => sendCommand(ring, "long command")).toThrow("full");
  expect(state[1]).toBe(1);
});
test("reject embedded NUL before publishing input", () => {
  const ring = new SharedArrayBuffer(32);
  expect(() => sendCommand(ring, "go\0quit")).toThrow("Invalid");
  expect(new Int32Array(ring)[1]).toBe(0);
});
test("accept coordinate moves and promotions, exclude analysis text", () => {
  expect(engineMove("move e7e8q")).toBe("e7e8q");
  expect(engineMove("1. ... g8f6")).toBe("g8f6");
  expect(engineMove("score 12 pv e2e4")).toBeNull();
  expect(engineMove("move a9a1")).toBeNull();
});
