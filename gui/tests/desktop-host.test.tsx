import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DesktopNotice } from "../src/components/desktop-notice";
import { LanguageProvider } from "../src/i18n/provider";
import { isDesktopShell } from "../src/desktop-host";

const keys = ["window", "document", "navigator", "localStorage", "IS_REACT_ACT_ENVIRONMENT"] as const;
let saved: Record<string, PropertyDescriptor | undefined>;
let win: Window;
let root: Root;
let container: HTMLElement;
beforeEach(() => {
  saved = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  win = new Window({ url: "http://127.0.0.1:41000/" });
  Object.defineProperty(win.navigator, "language", { value: "en-US", configurable: true });
  for (const [key, value] of Object.entries({ window: win, document: win.document, navigator: win.navigator, localStorage: win.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  container = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await win.happyDOM.close();
  for (const key of keys) {
    if (saved[key]) Object.defineProperty(globalThis, key, saved[key]!);
    else Reflect.deleteProperty(globalThis, key);
  }
});
test("ordinary browser dashboard keeps its existing controls", async () => {
  expect(isDesktopShell()).toBe(false);
  await act(async () => root.render(<LanguageProvider><DesktopNotice /></LanguageProvider>));
  expect(container.textContent).toBe("");
});
test("native desktop notice opens controls without executing a backend action", async () => {
  Object.defineProperty(win, "__OCX_DESKTOP__", { value: true });
  await act(async () => root.render(<LanguageProvider><DesktopNotice /></LanguageProvider>));
  expect(container.textContent).toContain("Desktop controls");
  const calls: string[] = [];
  const assign = win.location.assign.bind(win.location);
  win.location.assign = (url: string) => { calls.push(url); };
  try {
    await act(async () => container.querySelector("button")!.click());
    expect(calls).toEqual(["/desktop-controls"]);
  } finally { win.location.assign = assign; }
});
