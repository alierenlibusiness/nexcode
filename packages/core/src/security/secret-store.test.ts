import { describe, it, expect } from "vitest";
import { InMemorySecretStore } from "./secret-store";

describe("InMemorySecretStore", () => {
  it("writes, reads and deletes a secret", async () => {
    const store = new InMemorySecretStore();

    expect(await store.get("anthropic", "default")).toBeNull();

    await store.set("anthropic", "default", "sk-test-123");
    expect(await store.get("anthropic", "default")).toBe("sk-test-123");

    expect(await store.delete("anthropic", "default")).toBe(true);
    expect(await store.get("anthropic", "default")).toBeNull();
    expect(await store.delete("anthropic", "default")).toBe(false);
  });

  it("keeps service and account pairs isolated", async () => {
    const store = new InMemorySecretStore();
    await store.set("openai", "u1", "a");
    await store.set("openai", "u2", "b");
    expect(await store.get("openai", "u1")).toBe("a");
    expect(await store.get("openai", "u2")).toBe("b");
  });
});
