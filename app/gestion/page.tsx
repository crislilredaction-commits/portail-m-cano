"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type ClientRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  plate: string;
  plate_normalized?: string | null;
  vehicle_type: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
};

type QuoteRow = {
  id: string;
  quote_number: number;
  created_at: string;
  status: string | null;
  pdf_url: string | null;
  pdf_file_id: string | null;
  clients: {
    first_name: string | null;
    last_name: string | null;
    plate: string;
    email: string | null;
  } | null;
};

async function readJsonSafe(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  const raw = await res.text();

  if (!res.ok) throw new Error(`HTTP ${res.status} — ${raw.slice(0, 200)}`);
  if (!contentType.includes("application/json")) {
    throw new Error(
      `Réponse non-JSON (content-type: ${contentType}) — ${raw.slice(0, 200)}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`JSON invalide — ${raw.slice(0, 200)}`);
  }
}

export default function GestionPage() {
  const router = useRouter();

  const [tab, setTab] = useState<"clients" | "devis" | "factures">("clients");

  // Clients
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientQuery, setClientQuery] = useState("");

  // Devis
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quoteQuery, setQuoteQuery] = useState("");
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    // charge l’onglet actif
    if (tab === "clients") fetchClients();
    if (tab === "devis") fetchQuotes();
  }, [tab]);

  async function fetchClients() {
    setClientsLoading(true);
    setClients([]);
    try {
      const { data, error } = await supabase
        .from("clients")
        .select(
          "id, first_name, last_name, plate, plate_normalized, vehicle_type, phone, email, address",
        )
        .order("created_at", { ascending: false });

      if (error) throw error;
      setClients((data || []) as any);
    } catch (e: any) {
      // on reste simple : on affiche une liste vide
      console.error(e);
      setClients([]);
    } finally {
      setClientsLoading(false);
    }
  }

  async function fetchQuotes() {
    setQuotesLoading(true);
    setQuotes([]);
    try {
      const { data, error } = await supabase
        .from("quotes")
        .select(
          "id, quote_number, created_at, status, pdf_url, pdf_file_id, clients(first_name,last_name,plate,email)",
        )
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      setQuotes((data || []) as any);
    } catch (e: any) {
      console.error(e);
      setQuotes([]);
    } finally {
      setQuotesLoading(false);
    }
  }

  const filteredClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return clients;

    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    return clients.filter((c) => {
      const full = [
        c.first_name ?? "",
        c.last_name ?? "",
        c.plate ?? "",
        c.phone ?? "",
        c.email ?? "",
        c.vehicle_type ?? "",
      ].join(" ");
      return (
        full.toLowerCase().includes(q) || normalize(full).includes(normalize(q))
      );
    });
  }, [clientQuery, clients]);

  const filteredQuotes = useMemo(() => {
    const q = quoteQuery.trim().toLowerCase();
    if (!q) return quotes;

    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    return quotes.filter((qt) => {
      const c = qt.clients;
      const full = [
        String(qt.quote_number ?? ""),
        c?.first_name ?? "",
        c?.last_name ?? "",
        c?.plate ?? "",
        c?.email ?? "",
        qt.status ?? "",
      ].join(" ");
      return (
        full.toLowerCase().includes(q) || normalize(full).includes(normalize(q))
      );
    });
  }, [quoteQuery, quotes]);

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function sendQuoteEmail(quote: QuoteRow) {
    setSendMsg(null);
    setSendingId(quote.id);

    try {
      const toEmail = quote.clients?.email ?? null;
      if (!toEmail) {
        setSendMsg("⚠️ Email client manquant sur ce devis.");
        return;
      }
      if (!quote.pdf_file_id) {
        setSendMsg("⚠️ pdf_file_id manquant (impossible d’envoyer).");
        return;
      }

      const payload = {
        action: "send_quote_email",
        payload: {
          toEmail,
          quoteNumber: quote.quote_number,
          pdfFileId: quote.pdf_file_id,
        },
      };

      const response = await fetch("/api/apps-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await readJsonSafe(response);

      if (!result.ok) {
        setSendMsg(`❌ ${result.error ?? "Erreur Apps Script"}`);
        return;
      }

      if (result.emailSent) setSendMsg("✅ Devis envoyé ! 📧");
      else
        setSendMsg(
          `⚠️ Email non envoyé : ${result.emailError ?? "raison inconnue"}`,
        );
    } catch (e: any) {
      setSendMsg(`❌ ${e?.message ?? "Erreur inconnue"}`);
    } finally {
      setSendingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between mb-6">
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3">
            <Image
              src="/logo-garage.png"
              alt="Barthaux Auto"
              width={46}
              height={46}
              className="rounded-xl bg-white/10 p-1"
            />
            <div>
              <div className="font-extrabold text-lg">Barthaux Auto</div>
              <div className="text-white/60 text-sm">📊 Portail Gestion</div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              className="px-4 py-3 rounded-2xl font-extrabold bg-white/10 border border-white/10 hover:bg-white/15"
              onClick={() => router.push("/")}
              type="button"
            >
              🔧 Retour réparations
            </button>
            <button
              className="px-4 py-3 rounded-2xl font-extrabold bg-rose-400 text-slate-950 hover:opacity-90"
              onClick={logout}
              type="button"
            >
              🚪 Déconnexion
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="p-4 rounded-3xl bg-white/5 border border-white/10">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setTab("clients")}
              className={[
                "px-3 py-2 rounded-2xl font-extrabold border",
                tab === "clients"
                  ? "bg-emerald-400 text-slate-950 border-emerald-300"
                  : "bg-white/10 border-white/10 hover:bg-white/15",
              ].join(" ")}
              type="button"
            >
              👥 Clients
            </button>

            <button
              onClick={() => setTab("devis")}
              className={[
                "px-3 py-2 rounded-2xl font-extrabold border",
                tab === "devis"
                  ? "bg-emerald-400 text-slate-950 border-emerald-300"
                  : "bg-white/10 border-white/10 hover:bg-white/15",
              ].join(" ")}
              type="button"
            >
              🧾 Devis
            </button>

            <button
              onClick={() => setTab("factures")}
              className={[
                "px-3 py-2 rounded-2xl font-extrabold border",
                tab === "factures"
                  ? "bg-emerald-400 text-slate-950 border-emerald-300"
                  : "bg-white/10 border-white/10 hover:bg-white/15",
              ].join(" ")}
              type="button"
            >
              🧾 Factures (bientôt)
            </button>
          </div>

          {/* CLIENTS */}
          {tab === "clients" && (
            <div className="mt-4">
              <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                <div>
                  <div className="text-xl font-extrabold">👥 Clients</div>
                  <div className="text-white/60 text-sm">
                    Recherche + historique (V1)
                  </div>
                </div>

                <input
                  value={clientQuery}
                  onChange={(e) => setClientQuery(e.target.value)}
                  placeholder="🔎 Recherche (nom, plaque, tel, email, véhicule...)"
                  className="w-full md:w-[420px] px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none placeholder:text-white/40"
                />
              </div>

              <div className="mt-4 space-y-3">
                {clientsLoading && (
                  <div className="text-white/70">⏳ Chargement clients…</div>
                )}

                {!clientsLoading && filteredClients.length === 0 && (
                  <div className="p-4 rounded-2xl bg-black/30 border border-white/10 text-white/70">
                    Aucun client trouvé.
                  </div>
                )}

                {filteredClients.map((c) => (
                  <div
                    key={c.id}
                    className="p-4 rounded-2xl bg-black/30 border border-white/10"
                  >
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div>
                        <div className="font-extrabold">
                          {(c.first_name ?? "").trim()}{" "}
                          {(c.last_name ?? "").trim()}{" "}
                          <span className="text-white/60 font-bold">
                            — {c.plate}
                          </span>
                        </div>
                        <div className="text-white/60 text-sm">
                          {c.vehicle_type ?? "—"}{" "}
                          {c.phone ? ` • ☎️ ${c.phone}` : ""}{" "}
                          {c.email ? ` • 📧 ${c.email}` : ""}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 hover:bg-white/15 font-bold"
                          type="button"
                          onClick={() => {
                            // V1 : on fera la fiche ensuite
                            alert(
                              `Client: ${c.first_name ?? ""} ${c.last_name ?? ""}\nPlaque: ${c.plate}\nEmail: ${c.email ?? "-"}\nTel: ${c.phone ?? "-"}`,
                            );
                          }}
                        >
                          📄 Fiche
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DEVIS */}
          {tab === "devis" && (
            <div className="mt-4">
              <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                <div>
                  <div className="text-xl font-extrabold">🧾 Devis</div>
                  <div className="text-white/60 text-sm">
                    Ouvrir PDF + renvoyer (V1)
                  </div>
                </div>

                <input
                  value={quoteQuery}
                  onChange={(e) => setQuoteQuery(e.target.value)}
                  placeholder="🔎 Recherche (n° devis, client, plaque...)"
                  className="w-full md:w-[420px] px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none placeholder:text-white/40"
                />
              </div>

              {sendMsg && (
                <div className="mt-3 p-3 rounded-2xl bg-white/5 border border-white/10 text-white/80">
                  {sendMsg}
                </div>
              )}

              <div className="mt-4 space-y-3">
                {quotesLoading && (
                  <div className="text-white/70">⏳ Chargement devis…</div>
                )}

                {!quotesLoading && filteredQuotes.length === 0 && (
                  <div className="p-4 rounded-2xl bg-black/30 border border-white/10 text-white/70">
                    Aucun devis trouvé.
                  </div>
                )}

                {filteredQuotes.map((q) => (
                  <div
                    key={q.id}
                    className="p-4 rounded-2xl bg-black/30 border border-white/10"
                  >
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div>
                        <div className="font-extrabold">
                          Devis #{q.quote_number}{" "}
                          <span className="text-white/60 font-bold">
                            — {q.clients?.plate ?? "—"}
                          </span>
                        </div>
                        <div className="text-white/60 text-sm">
                          {(q.clients?.first_name ?? "").trim()}{" "}
                          {(q.clients?.last_name ?? "").trim()}
                          {q.clients?.email ? ` • 📧 ${q.clients.email}` : ""}
                          {q.created_at
                            ? ` • ${new Date(q.created_at).toLocaleString()}`
                            : ""}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          className={[
                            "px-3 py-2 rounded-xl font-bold",
                            q.pdf_url
                              ? "bg-emerald-400 text-slate-950 hover:opacity-90"
                              : "bg-white/10 text-white/40 cursor-not-allowed",
                          ].join(" ")}
                          type="button"
                          disabled={!q.pdf_url}
                          onClick={() => {
                            if (!q.pdf_url) return;
                            window.open(q.pdf_url, "_blank");
                          }}
                        >
                          📄 Ouvrir PDF
                        </button>

                        <button
                          className={[
                            "px-3 py-2 rounded-xl font-bold",
                            sendingId === q.id
                              ? "bg-white/10 text-white/40 cursor-not-allowed"
                              : "bg-sky-400 text-slate-950 hover:opacity-90",
                          ].join(" ")}
                          type="button"
                          disabled={sendingId === q.id}
                          onClick={() => sendQuoteEmail(q)}
                        >
                          {sendingId === q.id ? "⏳ Envoi..." : "📧 Renvoyer"}
                        </button>
                      </div>
                    </div>

                    {!q.pdf_file_id && (
                      <div className="mt-2 text-xs text-amber-300">
                        ⚠️ pdf_file_id manquant → impossible d’envoyer tant que
                        ce devis n’a pas été généré correctement.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FACTURES */}
          {tab === "factures" && (
            <div className="mt-4 p-4 rounded-2xl bg-black/30 border border-white/10 text-white/70">
              🧾 Factures : on arrive 👀 (prochaine étape après Clients + Devis)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
