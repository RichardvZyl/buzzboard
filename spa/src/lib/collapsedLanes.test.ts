import { describe, expect, it } from "vitest";
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
