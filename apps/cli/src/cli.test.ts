import { describe, it, expect } from "vitest";
import { parseArgs } from "./cli";

/** Command line parsing: `--key value`, `--key=value` and bare flags. */

describe("parseArgs", () => {
  it("separates the command from the positional arguments", () => {
    const result = parseArgs(["task", "add", "avatar", "upload"]);
    expect(result.command).toBe("task");
    expect(result.positional).toEqual(["add", "avatar", "upload"]);
  });

  it("leaves the command empty for empty input", () => {
    expect(parseArgs([])).toEqual({ command: "", positional: [], flags: {} });
  });

  it("reads the --key value form", () => {
    expect(parseArgs(["task", "x", "--mode", "deep"]).flags).toEqual({ mode: "deep" });
  });

  it("reads the --key=value form", () => {
    expect(parseArgs(["run", "--mode=fast"]).flags).toEqual({ mode: "fast" });
  });

  it("turns a valueless flag into true", () => {
    expect(parseArgs(["run", "--once"]).flags).toEqual({ once: true });
  });

  it("does not treat consecutive flags as each other's value", () => {
    expect(parseArgs(["run", "--once", "--json"]).flags).toEqual({ once: true, json: true });
  });

  it("does not confuse a flag value with a positional argument", () => {
    const result = parseArgs(["task", "goal text", "--mode", "balanced", "--json"]);
    expect(result.positional).toEqual(["goal text"]);
    expect(result.flags).toEqual({ mode: "balanced", json: true });
  });

  it("does not break a value that contains an equals sign", () => {
    expect(parseArgs(["run", "--dir=C:/a=b"]).flags).toEqual({ dir: "C:/a=b" });
  });

  it("preserves a positional argument that follows a flag", () => {
    const result = parseArgs(["approvals", "--approve", "ap-1"]);
    expect(result.command).toBe("approvals");
    expect(result.flags).toEqual({ approve: "ap-1" });
  });
});
