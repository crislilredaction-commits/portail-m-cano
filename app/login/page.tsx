"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMsg(`❌ ${error.message}`);
      setLoading(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl bg-white/5 border border-white/10 p-6 shadow-2xl">
        <h1 className="text-2xl font-extrabold">🔐 Connexion</h1>

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <input
            className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <input
            className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none"
            placeholder="Mot de passe"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />

          <button
            disabled={loading || !email || !password}
            className={[
              "w-full px-4 py-3 rounded-2xl font-extrabold transition",
              loading || !email || !password
                ? "bg-white/10 text-white/40 cursor-not-allowed"
                : "bg-emerald-400 text-slate-950 hover:opacity-90",
            ].join(" ")}
            type="submit"
          >
            {loading ? "⏳ Connexion..." : "✅ Se connecter"}
          </button>

          {msg && (
            <div className="text-sm text-white/80 bg-black/30 border border-white/10 rounded-2xl p-3">
              {msg}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
