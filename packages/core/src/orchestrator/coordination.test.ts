import { describe, it, expect } from "vitest";
import { followUpsForCompletion } from "./coordination";

describe("followUpsForCompletion (PRD §8.2/8.3/8.5/8.6)", () => {
  it("Backend tamamlandı → Security review + QA test (ikisi de)", () => {
    const out = followUpsForCompletion({ role: "backend", taskId: "t-1", files: ["api/u.ts"] });
    const types = out.map((m) => `${m.to}:${m.type}`);
    expect(types).toEqual(["security:review_request", "qa:test_request"]);
  });

  it("Frontend tamamlandı → yalnızca QA test (Security yok)", () => {
    const out = followUpsForCompletion({ role: "frontend", taskId: "t-2" });
    expect(out.map((m) => m.to)).toEqual(["qa"]);
    expect(out[0]?.type).toBe("test_request");
  });

  it("DevOps + güvenlik etkili → Security review", () => {
    const out = followUpsForCompletion({ role: "devops", taskId: "t-3", securitySensitive: true });
    expect(out.map((m) => m.to)).toEqual(["security"]);
  });

  it("DevOps + güvenlik etkisiz → takip mesajı yok", () => {
    expect(followUpsForCompletion({ role: "devops", taskId: "t-4" })).toEqual([]);
  });

  it("Security ve QA kendileri yeni iş üretmez (tetiklemeli roller)", () => {
    expect(followUpsForCompletion({ role: "security", taskId: "t-5" })).toEqual([]);
    expect(followUpsForCompletion({ role: "qa", taskId: "t-6" })).toEqual([]);
  });

  it("review_request payload diffId+files+taskId taşır", () => {
    const out = followUpsForCompletion({ role: "backend", taskId: "t-7", files: ["a.ts"], diffId: "d-9" });
    const review = out.find((m) => m.type === "review_request");
    expect(review?.payload).toMatchObject({ diffId: "d-9", files: ["a.ts"], taskId: "t-7" });
  });
});
