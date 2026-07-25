import { describe, expect, it } from "vitest";
import {
  PROJECT_CONTEXT_PATH,
  PROJECT_CONTEXT_TEMPLATE,
  ProjectContext,
  stripCodeFence,
  type ProjectContextPort,
} from "./project-context";

function makePort(initial: Record<string, string> = {}) {
  const files: Record<string, string> = { ...initial };
  const port: ProjectContextPort = {
    read: (_dir, rel) => Promise.resolve(files[rel] ?? null),
    write: (_dir, rel, content) => {
      files[rel] = content;
      return Promise.resolve();
    },
  };
  return { port, files };
}

describe("ProjectContext", () => {
  it("mevcut profili okur", async () => {
    const { port } = makePort({ [PROJECT_CONTEXT_PATH]: "# Profil\nNext.js + SQLite" });
    expect(await new ProjectContext(port, 6000).load("C:/p")).toContain("Next.js + SQLite");
  });

  it("profil yoksa boş döner — motor bölümü hiç eklemez", async () => {
    const { port } = makePort();
    expect(await new ProjectContext(port, 6000).load("C:/p")).toBe("");
  });

  it("bütçeyi aşan profili görünür biçimde kırpar", async () => {
    const { port } = makePort({ [PROJECT_CONTEXT_PATH]: "x".repeat(10_000) });
    const loaded = await new ProjectContext(port, 100).load("C:/p");
    expect(loaded).toContain("profil kırpıldı");
    expect(loaded.length).toBeLessThan(200);
  });

  it("profil yoksa iskeleti oluşturur, varsa üzerine yazmaz", async () => {
    const { port, files } = makePort();
    const context = new ProjectContext(port, 6000);

    await context.ensure("C:/p");
    expect(files[PROJECT_CONTEXT_PATH]).toBe(PROJECT_CONTEXT_TEMPLATE);

    files[PROJECT_CONTEXT_PATH] = "# Elle yazılmış";
    await context.ensure("C:/p");
    expect(files[PROJECT_CONTEXT_PATH]).toBe("# Elle yazılmış");
  });

  it("revizyon prompt'u changelog değil profil güncellemesi ister", () => {
    const { port } = makePort();
    const prompt = new ProjectContext(port, 6000).buildRevisePrompt("# Profil", "Avatar endpoint'i eklendi");
    expect(prompt).toContain("REVİZE et");
    expect(prompt).toContain("changelog DEĞİLDİR");
    expect(prompt).toContain("Avatar endpoint'i eklendi");
  });

  it("boş revizyon profili silmez", async () => {
    const { port, files } = makePort({ [PROJECT_CONTEXT_PATH]: "# Mevcut" });
    const saved = await new ProjectContext(port, 6000).save("C:/p", "   ");
    expect(saved).toBe(false);
    expect(files[PROJECT_CONTEXT_PATH]).toBe("# Mevcut");
  });

  it("revizyonu kod çitinden soyarak yazar", async () => {
    const { port, files } = makePort();
    const saved = await new ProjectContext(port, 6000).save("C:/p", "```markdown\n# Yeni Profil\n```");
    expect(saved).toBe(true);
    expect(files[PROJECT_CONTEXT_PATH]).toBe("# Yeni Profil\n");
  });
});

describe("stripCodeFence", () => {
  it("markdown çitini soyar", () => {
    expect(stripCodeFence("```markdown\n# A\n```")).toBe("# A");
    expect(stripCodeFence("```\n# A\n```")).toBe("# A");
  });

  it("çit yoksa metni değiştirmez", () => {
    expect(stripCodeFence("# A")).toBe("# A");
  });

  it("gövde içindeki kod bloklarını bozmaz", () => {
    const text = "# Başlık\n\n```ts\nconst a = 1;\n```\n\nSon";
    expect(stripCodeFence(text)).toBe(text);
  });
});
