import { test, expect } from "bun:test";
import { RoutingGate } from "../runtime/routing";

test("shutdown waits for the admitted routing write and rejects double clicks or late switches", async () => {
  const gate = new RoutingGate();
  let release!: () => void;
  const writing = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  expect(gate.run(async () => { calls.push("switch-start"); await writing; calls.push("switch-end"); })).toBe(true);
  expect(gate.run(async () => { calls.push("duplicate"); })).toBe(false);
  const stopped = gate.close().then(() => { calls.push("shutdown"); });
  await Promise.resolve();
  expect(calls).toEqual(["switch-start"]);
  expect(gate.run(async () => { calls.push("late"); })).toBe(false);
  release();
  await stopped;
  expect(calls).toEqual(["switch-start", "switch-end", "shutdown"]);
});

test("after one completed switch the reverse switch can run without restarting the backend", async () => {
  const gate = new RoutingGate();
  let first!: () => void;
  const finished = new Promise<void>(resolve => { first = resolve; });
  expect(gate.run(async () => { first(); })).toBe(true);
  await finished;
  await Promise.resolve();
  expect(gate.run(async () => {})).toBe(true);
  await gate.close();
});
