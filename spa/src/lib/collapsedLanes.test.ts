import { afterEach, describe, expect, it } from "vitest";
import {
  COLLAPSED_LANES_KEY,
  readCollapsedLanes,
  writeCollapsedLanes,
} from "./collapsedLanes";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
    data,
  };
}

describe("collapsedLanes storage", () => {
  it("round-trips lane addresses", () => {
    const storage = memoryStorage();
    writeCollapsedLanes(new Set(["a", "b"]), storage);
    expect(storage.data[COLLAPSED_LANES_KEY]).toBe(JSON.stringify(["a", "b"]));
    expect([...readCollapsedLanes(storage)].sort()).toEqual(["a", "b"]);
  });

  it("returns empty on missing, invalid, or non-string entries", () => {
    expect([...readCollapsedLanes(memoryStorage())]).toEqual([]);
    expect([...readCollapsedLanes(memoryStorage({ [COLLAPSED_LANES_KEY]: "{" }))]).toEqual([]);
    expect([...readCollapsedLanes(memoryStorage({ [COLLAPSED_LANES_KEY]: '{"x":1}' }))]).toEqual([]);
    expect([...readCollapsedLanes(memoryStorage({
      [COLLAPSED_LANES_KEY]: JSON.stringify(["ok", 1, null]),
    }))]).toEqual(["ok"]);
  });

  it("swallows setItem failures", () => {
    const storage = {
      setItem() {
        throw new Error("quota");
      },
      getItem() {
        return null;
      },
    };
    expect(() => writeCollapsedLanes(new Set(["x"]), storage)).not.toThrow();
  });
});

describe("collapsedLanes with unavailable browser storage", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  function defineStorage(descriptor: PropertyDescriptor) {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, ...descriptor });
  }

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("falls back to empty and does not throw when reading localStorage throws", () => {
    defineStorage({
      get() {
        throw new Error("SecurityError: storage blocked");
      },
    });
    expect([...readCollapsedLanes()]).toEqual([]);
    expect(() => writeCollapsedLanes(new Set(["x"]))).not.toThrow();
  });

  it("falls back to empty when localStorage is not defined", () => {
    defineStorage({ get: () => undefined });
    expect([...readCollapsedLanes()]).toEqual([]);
    expect(() => writeCollapsedLanes(new Set(["x"]))).not.toThrow();
  });
});