import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./connection";
import { ConfigRepository } from "./config-repo";
import { FALLBACK_CONFIG } from "../config/defaults";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexcode-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function templateWith(body: unknown): string {
  const path = join(dir, "template.json");
  writeFileSync(path, JSON.stringify(body), "utf8");
  return path;
}

function repo(templatePath: string): ConfigRepository {
  return new ConfigRepository(openDatabase(":memory:"), templatePath);
}

describe("ConfigRepository", () => {
  it("seeds from the template on the first read and persists it", () => {
    const r = repo(templateWith({ ...FALLBACK_CONFIG, workingDir: "/seed" }));
    expect(r.load().workingDir).toBe("/seed");

    // The second read comes from the record; the value survives the template being deleted.
    rmSync(join(dir, "template.json"), { force: true });
    expect(r.load().workingDir).toBe("/seed");
  });

  it("falls back to the in-code safe base when the template is missing", () => {
    const r = repo(join(dir, "missing.json"));
    expect(r.load().workingDir).toBe(FALLBACK_CONFIG.workingDir);
  });

  it("does not lock up on a corrupt template; it falls back to the safe base", () => {
    const path = join(dir, "template.json");
    writeFileSync(path, "{ broken json", "utf8");
    expect(repo(path).load().workingDir).toBe(FALLBACK_CONFIG.workingDir);
  });

  it("falls back to the safe base when the stored record is corrupt", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO engine_state (key, value) VALUES ('config', 'corrupt')").run();
    const r = new ConfigRepository(db, templateWith(FALLBACK_CONFIG));
    expect(r.load().workingDir).toBe(FALLBACK_CONFIG.workingDir);
  });

  it("normalises on save and fills in the missing fields", () => {
    const r = repo(templateWith(FALLBACK_CONFIG));
    const saved = r.save({ ...FALLBACK_CONFIG, approvalMode: "ask" });
    expect(saved.approvalMode).toBe("ask");
    expect(r.load().approvalMode).toBe("ask");
  });

  it("resetToTemplate returns the user's change to the template", () => {
    const r = repo(templateWith({ ...FALLBACK_CONFIG, workingDir: "/template" }));
    r.save({ ...FALLBACK_CONFIG, workingDir: "/user" });
    expect(r.load().workingDir).toBe("/user");

    expect(r.resetToTemplate().workingDir).toBe("/template");
    expect(r.load().workingDir).toBe("/template");
  });
});
