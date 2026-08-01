import { describe, it, expect } from "vitest";
import { classifyAction, requiresHumanApproval } from "./gate";
import type { AutonomyLevel } from "../domain/agent";

describe("classifyAction", () => {
  it("yıkıcı eylemleri 'required' olarak sınıflar", () => {
    expect(classifyAction("git_push")).toBe("required");
    expect(classifyAction("file_delete")).toBe("required");
    expect(classifyAction("production_deploy")).toBe("required");
    expect(classifyAction("irreversible_migration")).toBe("required");
  });

  it("yeni dosya/bağımlılık ekleme 'optional'", () => {
    expect(classifyAction("file_create")).toBe("optional");
    expect(classifyAction("dependency_add")).toBe("optional");
  });

  it("zararsız/bilinmeyen eylemler 'auto'", () => {
    expect(classifyAction("file_read")).toBe("auto");
    expect(classifyAction("lint")).toBe("auto");
    expect(classifyAction("test_run")).toBe("auto");
  });
});

describe("requiresHumanApproval: sıfır tolerans", () => {
  const levels: AutonomyLevel[] = ["manual", "supervised", "autonomous"];

  it("'required' eylemler HER otonomi seviyesinde onay gerektirir", () => {
    for (const level of levels) {
      expect(requiresHumanApproval("git_push", level)).toBe(true);
      expect(requiresHumanApproval("file_delete", level)).toBe(true);
    }
  });

  it("'optional' eylemler yalnızca manual'de onay gerektirir", () => {
    expect(requiresHumanApproval("file_create", "manual")).toBe(true);
    expect(requiresHumanApproval("file_create", "supervised")).toBe(false);
    expect(requiresHumanApproval("file_create", "autonomous")).toBe(false);
  });

  it("'auto' eylemler hiçbir seviyede onay gerektirmez", () => {
    for (const level of levels) {
      expect(requiresHumanApproval("file_read", level)).toBe(false);
    }
  });
});
