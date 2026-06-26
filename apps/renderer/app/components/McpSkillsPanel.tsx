"use client";

import { useEffect, useState } from "react";

interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  running: boolean;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  prompt: string;
  createdAt: string;
}

export function McpSkillsPanel({
  disabled,
}: {
  disabled: boolean;
}) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);

  // MCP Form State
  const [mcpName, setMcpName] = useState("");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");
  const [mcpEnv, setMcpEnv] = useState("");

  // Skill Form State
  const [skillName, setSkillName] = useState("");
  const [skillDesc, setSkillDesc] = useState("");
  const [skillPrompt, setSkillPrompt] = useState("");

  const [loading, setLoading] = useState(false);

  const fetchAll = async () => {
    if (!window.nexcode) return;
    setLoading(true);
    try {
      const [srvList, skList] = await Promise.all([
        window.nexcode.listMcpServers(),
        window.nexcode.listSkills(),
      ]);
      setServers(srvList as McpServer[]);
      setSkills(skList as Skill[]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAll();
  }, []);

  const handleSaveMcp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.nexcode || !mcpName.trim() || !mcpCommand.trim()) return;

    setLoading(true);
    try {
      // Parse arguments
      const args = mcpArgs
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);

      // Parse env variables
      let env: Record<string, string> = {};
      if (mcpEnv.trim()) {
        try {
          env = JSON.parse(mcpEnv);
        } catch {
          // Fallback to KEY=VAL newline separated if JSON fails
          mcpEnv.split("\n").forEach((line) => {
            const index = line.indexOf("=");
            if (index !== -1) {
              const k = line.slice(0, index).trim();
              const v = line.slice(index + 1).trim();
              if (k) env[k] = v;
            }
          });
        }
      }

      await window.nexcode.saveMcpServer({
        name: mcpName.trim(),
        command: mcpCommand.trim(),
        args,
        env,
      });

      setMcpName("");
      setMcpCommand("");
      setMcpArgs("");
      setMcpEnv("");

      await fetchAll();
    } catch (e: unknown) {
      const err = e as Error;
      alert(`Hata: ${String(err.message || err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.nexcode || !skillName.trim() || !skillPrompt.trim()) return;

    setLoading(true);
    try {
      await window.nexcode.saveSkill({
        name: skillName.trim().replace(/\s+/g, "_"),
        description: skillDesc.trim(),
        prompt: skillPrompt.trim(),
      });

      setSkillName("");
      setSkillDesc("");
      setSkillPrompt("");

      await fetchAll();
    } catch (e: unknown) {
      const err = e as Error;
      alert(`Hata: ${String(err.message || err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleMcp = async (id: string, enabled: boolean) => {
    if (!window.nexcode) return;
    setLoading(true);
    try {
      await window.nexcode.toggleMcpServer(id, enabled);
      await fetchAll();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveMcp = async (id: string) => {
    if (!window.nexcode) return;
    if (!confirm("Bu MCP sunucusunu kaldırmak istediğinize emin misiniz?")) return;
    setLoading(true);
    try {
      await window.nexcode.removeMcpServer(id);
      await fetchAll();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveSkill = async (id: string) => {
    if (!window.nexcode) return;
    if (!confirm("Bu Skill'i silmek istediğinize emin misiniz?")) return;
    setLoading(true);
    try {
      await window.nexcode.removeSkill(id);
      await fetchAll();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col space-y-4 overflow-y-auto p-4 select-none">
      {/* MCP Servers Section */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-brand-300 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-400 animate-pulse" /> MCP Sunucuları (Stdio)
        </h3>
        <p className="text-[10px] leading-relaxed text-neutral-400">
          Uygulamanın araç havuzunu genişletmek için harici MCP sunucuları tanımlayın.
        </p>

        {/* Server List */}
        <div className="space-y-2">
          {servers.length === 0 && (
            <p className="text-[10px] text-neutral-600 italic">Kayıtlı MCP sunucusu bulunmuyor.</p>
          )}
          {servers.map((s) => (
            <div
              key={s.id}
              className="group relative rounded-xl border border-ink-700 bg-ink-900/40 p-3 transition-all hover:border-brand-500/30 hover:bg-ink-900/60"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-neutral-100">{s.name}</span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium transition-all ${
                        s.enabled && s.running
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-neutral-800 text-neutral-500"
                      }`}
                    >
                      <span
                        className={`h-1 w-1 rounded-full ${
                          s.enabled && s.running ? "bg-emerald-400 animate-pulse" : "bg-neutral-500"
                        }`}
                      />
                      {s.enabled && s.running ? "çalışıyor" : "pasif"}
                    </span>
                  </div>
                  <code className="mt-1 block text-[10px] font-mono text-neutral-400 truncate max-w-[280px]">
                    {s.command} {s.args.join(" ")}
                  </code>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    disabled={disabled || loading}
                    onClick={() => handleToggleMcp(s.id, !s.enabled)}
                    className={`rounded-md px-1.5 py-0.5 text-[9px] font-semibold transition ${
                      s.enabled
                        ? "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                        : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                    }`}
                  >
                    {s.enabled ? "Durdur" : "Başlat"}
                  </button>
                  <button
                    disabled={disabled || loading}
                    onClick={() => handleRemoveMcp(s.id)}
                    className="rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-rose-400 hover:bg-rose-500/20 transition"
                  >
                    Sil
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Add Server Form */}
        <form onSubmit={handleSaveMcp} className="panel-flat rounded-xl p-3 space-y-2">
          <p className="text-[10px] font-bold text-neutral-300">MCP Sunucusu Ekle</p>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Sunucu Adı (Örn: filesystem)"
              required
              value={mcpName}
              disabled={disabled || loading}
              onChange={(e) => setMcpName(e.target.value)}
              className="field w-full py-1 text-[11px]"
            />
            <input
              type="text"
              placeholder="Komut (Örn: node, python)"
              required
              value={mcpCommand}
              disabled={disabled || loading}
              onChange={(e) => setMcpCommand(e.target.value)}
              className="field w-full py-1 text-[11px]"
            />
          </div>
          <input
            type="text"
            placeholder="Argümanlar (Virgülle ayırın, Örn: dist/index.js, C:/src)"
            value={mcpArgs}
            disabled={disabled || loading}
            onChange={(e) => setMcpArgs(e.target.value)}
            className="field w-full py-1 text-[11px]"
          />
          <textarea
            placeholder="Ortam Değişkenleri (JSON formatında veya KEY=VAL her satıra bir adet)"
            rows={2}
            value={mcpEnv}
            disabled={disabled || loading}
            onChange={(e) => setMcpEnv(e.target.value)}
            className="field w-full resize-none py-1 text-[11px] font-mono"
          />
          <button
            type="submit"
            disabled={disabled || loading || !mcpName.trim() || !mcpCommand.trim()}
            className="btn-brand w-full py-1 text-xs"
          >
            MCP Sunucusunu Kaydet
          </button>
        </form>
      </div>

      <hr className="border-ink-700" />

      {/* Skills Section */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-brand-300 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" /> Custom Skills
        </h3>
        <p className="text-[10px] leading-relaxed text-neutral-400">
          Chat üzerinden <code className="text-violet-300">/skill &lt;isim&gt;</code> şeklinde tetiklenebilen özel prompt şablonları.
        </p>

        {/* Skill List */}
        <div className="space-y-2">
          {skills.length === 0 && (
            <p className="text-[10px] text-neutral-600 italic">Kayıtlı Skill bulunmuyor.</p>
          )}
          {skills.map((sk) => (
            <div
              key={sk.id}
              className="group relative rounded-xl border border-ink-700 bg-ink-900/40 p-3 transition-all hover:border-brand-500/30 hover:bg-ink-900/60"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-neutral-100">/{sk.name}</span>
                    <span className="text-[9px] text-neutral-500 font-mono">
                      {new Date(sk.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-neutral-400">{sk.description}</p>
                </div>
                <button
                  disabled={disabled || loading}
                  onClick={() => handleRemoveSkill(sk.id)}
                  className="rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-rose-400 hover:bg-rose-500/20 transition"
                >
                  Sil
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add Skill Form */}
        <form onSubmit={handleSaveSkill} className="panel-flat rounded-xl p-3 space-y-2">
          <p className="text-[10px] font-bold text-neutral-300">Yeni Skill Ekle</p>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Skill Adı (Boşluksuz, örn: test_et)"
              required
              value={skillName}
              disabled={disabled || loading}
              onChange={(e) => setSkillName(e.target.value)}
              className="field w-full py-1 text-[11px]"
            />
            <input
              type="text"
              placeholder="Açıklama (Örn: Hızlı test planı)"
              value={skillDesc}
              disabled={disabled || loading}
              onChange={(e) => setSkillDesc(e.target.value)}
              className="field w-full py-1 text-[11px]"
            />
          </div>
          <textarea
            placeholder="Skill Prompt Talimatı (Örn: Bu kodun tüm sınır durumları için vitest testlerini yaz...)"
            required
            rows={3}
            value={skillPrompt}
            disabled={disabled || loading}
            onChange={(e) => setSkillPrompt(e.target.value)}
            className="field w-full resize-none py-1 text-[11px]"
          />
          <button
            type="submit"
            disabled={disabled || loading || !skillName.trim() || !skillPrompt.trim()}
            className="btn-brand w-full py-1 text-xs"
          >
            Skill Kaydet
          </button>
        </form>
      </div>
    </div>
  );
}
