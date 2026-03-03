"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

const TEMPLATE_DEVIS_ID = "1bMPPNhblzGb9HCXftPtYd-fwEx_gRKgb8WECfS2xs2c";

type Repair = {
  id: string;
  repair_type: string | null;
  estimated_duration: string | null;
  status: "a_faire" | "en_cours" | "en_pause" | "terminee";
  comment: string | null;
  clients: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    plate: string;
    vehicle_type: string | null;
    phone: string | null;
  };
};

type NewRepairForm = {
  first_name: string;
  last_name: string;
  address: string;
  email: string;
  phone: string;
  plate: string;
  vehicle_type: string;
  repair_type: string;
  estimated_duration: string;
  comment: string;
};

const emptyForm: NewRepairForm = {
  first_name: "",
  last_name: "",
  address: "",
  email: "",
  phone: "",
  plate: "",
  vehicle_type: "",
  repair_type: "",
  estimated_duration: "",
  comment: "",
};

/** Plaque affichage : AB-123-CD */
function normalizePlate(input: string) {
  const s = (input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length === 7)
    return `${s.slice(0, 2)}-${s.slice(2, 5)}-${s.slice(5, 7)}`;
  return (input || "").toUpperCase();
}

/** Plaque clé : AB123CD */
function normalizePlateKey(input: string) {
  return (input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function readJsonSafe(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} — ${raw.slice(0, 200)}`);
  }

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

export default function Home() {
  const router = useRouter();

  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);

  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<NewRepairForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [showMecanoPanel, setShowMecanoPanel] = useState(false);
  const [mecanoTab, setMecanoTab] = useState<"devis" | "entreprise">("devis");

  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);

  const companyText = `BARTHAUX AUTO
Adresse : 9 Rue du Chauffour, 10700 Arcis sur Aube
Téléphone : 07.69.12.75.75
Email : barthauxauto2.0@gmail.com
SIRET : 99088236700016
APE : 4520A
`;

  /** 🧾 Devis */
  const [quotePlate, setQuotePlate] = useState("");
  const [laborCost, setLaborCost] = useState<number>(0);
  const [quoteItems, setQuoteItems] = useState<
    { description: string; unit_price: number; quantity: number }[]
  >([{ description: "", unit_price: 0, quantity: 1 }]);
  const [quoteMessage, setQuoteMessage] = useState<string | null>(null);

  const [quoteClientInfo, setQuoteClientInfo] = useState<{
    name: string;
    vehicle: string | null;
  } | null>(null);

  const [lastQuote, setLastQuote] = useState<{
    id: string;
    quoteNumber: number;
    pdfFileId: string | null;
    clientEmail: string | null;
  } | null>(null);

  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>(
    {},
  );
  const [savingCommentId, setSavingCommentId] = useState<string | null>(null);
  const [commentMsg, setCommentMsg] = useState<Record<string, string>>({});

  useEffect(() => {
    let sub: any;

    async function check() {
      const { data } = await supabase.auth.getSession();
      const ok = Boolean(data.session);

      setIsAuthed(ok);
      setAuthLoading(false);

      if (!ok) router.replace("/login");

      sub = supabase.auth.onAuthStateChange((_event, session) => {
        const authed = Boolean(session);
        setIsAuthed(authed);
        if (!authed) router.replace("/login");
      });
    }

    check();

    return () => {
      if (sub?.data?.subscription) sub.data.subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    async function checkClient() {
      const plateKey = normalizePlateKey(quotePlate);
      const platePretty = normalizePlate(quotePlate);

      if (!plateKey) {
        setQuoteClientInfo(null);
        return;
      }

      let client = null;

      const { data: c1 } = await supabase
        .from("clients")
        .select("first_name, last_name, vehicle_type")
        .eq("plate_normalized", plateKey)
        .limit(1)
        .single();

      if (c1) {
        client = c1;
      } else {
        const { data: c2 } = await supabase
          .from("clients")
          .select("first_name, last_name, vehicle_type")
          .eq("plate", platePretty)
          .limit(1)
          .single();

        if (c2) client = c2;
      }

      if (client) {
        setQuoteClientInfo({
          name: `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim(),
          vehicle: client.vehicle_type ?? null,
        });
      } else {
        setQuoteClientInfo(null);
      }
    }

    checkClient();
  }, [quotePlate]);

  useEffect(() => {
    fetchRepairs();
  }, []);

  async function fetchRepairs() {
    setLoading(true);
    const { data, error } = await supabase
      .from("repairs")
      .select(
        `
        id,
        repair_type,
        estimated_duration,
        status,
        comment,
        clients (
          id,
          first_name,
          last_name,
          plate,
          vehicle_type,
          phone
        )
      `,
      )
      .neq("status", "terminee")
      .order("created_at", { ascending: false });

    if (!error && data) setRepairs(data as any);
    else setRepairs([]);
    setLoading(false);
  }

  async function startRepair(id: string) {
    await supabase.from("repairs").update({ status: "en_cours" }).eq("id", id);
    fetchRepairs();
  }

  async function pauseRepair(id: string) {
    await supabase.from("repairs").update({ status: "en_pause" }).eq("id", id);
    fetchRepairs();
  }

  async function resumeRepair(id: string) {
    await supabase.from("repairs").update({ status: "en_cours" }).eq("id", id);
    fetchRepairs();
  }

  async function finishRepair(id: string) {
    await supabase.rpc("complete_repair", { p_repair_id: id });
    fetchRepairs();
  }

  async function saveRepairComment(repairId: string) {
    try {
      setSavingCommentId(repairId);

      const draft = (commentDrafts[repairId] ?? "").trim();

      const { error } = await supabase
        .from("repairs")
        .update({ comment: draft.length ? draft : null })
        .eq("id", repairId);

      if (error) throw error;

      await fetchRepairs();

      setCommentMsg((prev) => ({
        ...prev,
        [repairId]: "✅ Commentaire enregistré",
      }));
    } catch (e: any) {
      setCommentMsg((prev) => ({
        ...prev,
        [repairId]: `❌ ${e?.message ?? "Erreur enregistrement"}`,
      }));
    } finally {
      setSavingCommentId(null);
    }
  }

  function openModal() {
    setForm(emptyForm);
    setFormError(null);
    setIsOpen(true);
  }

  function closeModal() {
    setIsOpen(false);
  }

  function updateField<K extends keyof NewRepairForm>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const canSave = useMemo(() => {
    return (
      form.plate.trim().length >= 4 &&
      form.vehicle_type.trim().length > 0 &&
      form.repair_type.trim().length > 0
    );
  }, [form]);

  const filteredRepairs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repairs;
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    return repairs.filter((r) => {
      const plate = r.clients.plate ?? "";
      const full = [
        r.clients.first_name ?? "",
        r.clients.last_name ?? "",
        r.clients.phone ?? "",
        r.repair_type ?? "",
        r.clients.vehicle_type ?? "",
        plate,
      ].join(" ");
      return (
        full.toLowerCase().includes(q) || normalize(full).includes(normalize(q))
      );
    });
  }, [query, repairs]);

  /** ✅ CREATION REPARATION + CLIENT */
  async function createRepair() {
    setFormError(null);
    if (!canSave) {
      setFormError(
        "⚠️ Il manque au minimum : Plaque + Type véhicule + Type réparation.",
      );
      return;
    }

    setSaving(true);
    try {
      const platePretty = normalizePlate(form.plate);
      const plateKey = normalizePlateKey(form.plate);

      if (!plateKey) {
        setFormError("⚠️ Plaque invalide.");
        return;
      }

      let clientId: string | null = null;
      const { data: foundByNorm, error: findErr } = await supabase
        .from("clients")
        .select("id")
        .eq("plate_normalized", plateKey)
        .limit(1);

      if (findErr) throw findErr;
      clientId = foundByNorm?.[0]?.id ?? null;

      if (!clientId) {
        const { data: foundByPlate } = await supabase
          .from("clients")
          .select("id")
          .eq("plate", platePretty)
          .limit(1);
        clientId = foundByPlate?.[0]?.id ?? null;
      }

      if (!clientId) {
        const { data: insertedClient, error: insertClientErr } = await supabase
          .from("clients")
          .insert({
            first_name: form.first_name || null,
            last_name: form.last_name || null,
            address: form.address || null,
            email: form.email || null,
            phone: form.phone || null,
            plate: platePretty,
            vehicle_type: form.vehicle_type || null,
            notes: null,
          })
          .select("id")
          .single();

        if (insertClientErr) throw insertClientErr;
        clientId = insertedClient.id;
      } else {
        const { error: updErr } = await supabase
          .from("clients")
          .update({
            first_name: form.first_name || undefined,
            last_name: form.last_name || undefined,
            address: form.address || undefined,
            email: form.email || undefined,
            phone: form.phone || undefined,
            vehicle_type: form.vehicle_type || undefined,
            plate: platePretty,
          })
          .eq("id", clientId);

        if (updErr) throw updErr;
      }

      const { error: insertRepairErr } = await supabase.from("repairs").insert({
        client_id: clientId,
        repair_type: form.repair_type,
        estimated_duration: form.estimated_duration || null,
        status: "a_faire",
        comment: form.comment || null,
      });

      if (insertRepairErr) throw insertRepairErr;

      await fetchRepairs();
      closeModal();
    } catch (e: any) {
      setFormError(`❌ Oups : ${e?.message ?? "Erreur inconnue"}`);
    } finally {
      setSaving(false);
    }
  }

  function openMecano(tab: "devis" | "entreprise") {
    setMecanoTab(tab);
    setShowMecanoPanel(true);
  }

  /** 🧾 Devis helpers */
  function addQuoteItem() {
    setQuoteItems((prev) => [
      ...prev,
      { description: "", unit_price: 0, quantity: 1 },
    ]);
  }

  function updateQuoteItem(
    index: number,
    field: "description" | "unit_price" | "quantity",
    value: string,
  ) {
    setQuoteItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? {
              ...item,
              [field]: field === "description" ? value : Number(value),
            }
          : item,
      ),
    );
  }

  const computedPartsTotal = useMemo(() => {
    return quoteItems.reduce(
      (sum, it) =>
        sum + (Number(it.unit_price) || 0) * (Number(it.quantity) || 0),
      0,
    );
  }, [quoteItems]);

  const computedTotal = useMemo(() => {
    return Number(computedPartsTotal) + (Number(laborCost) || 0);
  }, [computedPartsTotal, laborCost]);

  async function getClientIdForPlate(
    plateInput: string,
  ): Promise<string | null> {
    const plateKey = normalizePlateKey(plateInput);
    const platePretty = normalizePlate(plateInput);
    if (!plateKey) return null;

    const { data: c1 } = await supabase
      .from("clients")
      .select("id")
      .eq("plate_normalized", plateKey)
      .limit(1);

    const id1 = c1?.[0]?.id ?? null;
    if (id1) return id1;

    const { data: c2 } = await supabase
      .from("clients")
      .select("id")
      .eq("plate", platePretty)
      .limit(1);

    return c2?.[0]?.id ?? null;
  }

  async function loadLatestQuoteForCurrentPlate() {
    const clientId = await getClientIdForPlate(quotePlate);
    if (!clientId) return null;

    const { data, error } = await supabase
      .from("quotes")
      .select("id, quote_number, pdf_file_id, clients(email)")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;

    const email = (data as any)?.clients?.email ?? null;

    return {
      id: data.id as string,
      quoteNumber: data.quote_number as number,
      pdfFileId: (data as any).pdf_file_id as string | null,
      clientEmail: email as string | null,
    };
  }

  async function createQuote() {
    setQuoteMessage(null);
    if (creating) return;

    setCreating(true);

    try {
      const plateKey = normalizePlateKey(quotePlate);
      if (!plateKey) {
        setQuoteMessage("⚠️ Plaque obligatoire.");
        return;
      }

      const clientId = await getClientIdForPlate(quotePlate);
      if (!clientId) {
        setQuoteMessage("❌ Aucun client trouvé pour cette plaque.");
        return;
      }

      const { data: numberData, error: numberError } = await supabase.rpc(
        "generate_quote_number",
      );

      if (numberError || !numberData) {
        setQuoteMessage("❌ Impossible de générer le numéro de devis");
        return;
      }

      const quoteNumber = numberData;

      const { data: newQuote, error: quoteError } = await supabase
        .from("quotes")
        .insert({
          client_id: clientId,
          labor_cost: Number(laborCost) || 0,
          status: "brouillon",
          quote_number: quoteNumber,
        })
        .select()
        .single();

      if (quoteError || !newQuote) {
        setQuoteMessage("❌ Erreur création devis");
        return;
      }

      for (const item of quoteItems) {
        if (!item.description?.trim()) continue;

        await supabase.from("quote_items").insert({
          quote_id: newQuote.id,
          description: item.description,
          unit_price: Number(item.unit_price) || 0,
          quantity: Number(item.quantity) || 0,
        });
      }

      const { data: clientData } = await supabase
        .from("clients")
        .select("*")
        .eq("id", clientId)
        .single();

      const payload = {
        action: "generate_quote",
        payload: {
          quoteNumber: newQuote.quote_number,
          date: new Date().toISOString().slice(0, 10),
          client: {
            firstName: clientData.first_name,
            lastName: clientData.last_name,
            address: clientData.address,
            email: clientData.email,
            phone: clientData.phone,
            plate: clientData.plate,
            vehicleType: clientData.vehicle_type,
          },
          items: quoteItems.map((i) => ({
            designation: i.description,
            qty: i.quantity,
            unitPrice: i.unit_price,
          })),
          labor: laborCost,
          totals: {
            partsTotal: computedPartsTotal,
            total: computedTotal,
          },
        },
      };

      const response = await fetch("/api/apps-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await readJsonSafe(response);

      if (!result.ok) {
        setQuoteMessage(`❌ ${result.error ?? "Erreur Apps Script"}`);
        return;
      }

      await supabase
        .from("quotes")
        .update({
          doc_url: result.docUrl,
          pdf_url: result.pdfUrl,
          pdf_file_id: result.pdfFileId ?? null,
          doc_id: result.docId ?? null,
          folder_id: result.folderId ?? null,
        })
        .eq("id", newQuote.id);

      setLastQuote({
        id: newQuote.id,
        quoteNumber: newQuote.quote_number,
        pdfFileId: result.pdfFileId ?? null,
        clientEmail: clientData.email ?? null,
      });

      window.open(result.pdfUrl, "_blank");
      setQuoteMessage("✅ Devis généré !");
    } catch (e: any) {
      setQuoteMessage(`❌ Oups : ${e?.message ?? "Erreur inconnue"}`);
    } finally {
      setCreating(false);
    }
  }

  async function sendQuoteEmail() {
    setQuoteMessage(null);
    if (sending) return;

    setSending(true);

    try {
      let quote = lastQuote;
      if (!quote) {
        quote = await loadLatestQuoteForCurrentPlate();
        if (quote) setLastQuote(quote);
      }

      if (!quote) {
        setQuoteMessage(
          "⚠️ Aucun devis trouvé pour ce client. Génère d’abord un devis.",
        );
        return;
      }

      if (!quote.clientEmail) {
        setQuoteMessage("⚠️ Aucun email client enregistré.");
        return;
      }

      if (!quote.pdfFileId) {
        const refreshed = await loadLatestQuoteForCurrentPlate();
        if (refreshed?.pdfFileId) {
          quote = refreshed;
          setLastQuote(refreshed);
        }
      }

      if (!quote.pdfFileId) {
        setQuoteMessage(
          "⚠️ PDF non prêt (pdfFileId manquant). Regénère le devis.",
        );
        return;
      }

      const payload = {
        action: "send_quote_email",
        payload: {
          toEmail: quote.clientEmail,
          quoteNumber: quote.quoteNumber,
          pdfFileId: quote.pdfFileId,
        },
      };

      const response = await fetch("/api/apps-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await readJsonSafe(response);

      if (!result.ok) {
        setQuoteMessage(`❌ Apps Script: ${result.error ?? "Erreur inconnue"}`);
        return;
      }

      if (result.emailSent) {
        setQuoteMessage("✅ Email envoyé ! 📧");
      } else {
        setQuoteMessage(
          `⚠️ Email non envoyé : ${result.emailError ?? "raison inconnue"}`,
        );
      }
    } catch (e: any) {
      setQuoteMessage(`❌ Oups : ${e?.message ?? "Erreur inconnue"}`);
    } finally {
      setSending(false);
    }
  }

  function openDevisForPlate(plate: string) {
    setQuotePlate(normalizePlate(plate));
    setMecanoTab("devis");
    setShowMecanoPanel(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-white/70">⏳ Vérification accès…</div>
      </div>
    );
  }

  if (!isAuthed) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between mb-6">
          {/* Cartouche - prend plus de place */}
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3 flex-1 min-w-0">
            <Image
              src="/logo-garage.png"
              alt="Barthaux Auto"
              width={56}
              height={56}
              className="rounded-xl bg-white/10 p-1 shrink-0"
            />
            <div className="min-w-0">
              <div className="font-extrabold text-xl truncate">
                Barthaux Auto
              </div>
              <div className="text-white/60 text-sm truncate">Bienvenue :)</div>
            </div>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:flex-none">
            <button
              className="w-full px-4 py-3 rounded-2xl font-extrabold bg-emerald-400 text-slate-950 shadow-lg hover:opacity-90"
              onClick={() => openMecano("devis")}
              type="button"
            >
              🔧 Accès Mécano
            </button>

            <button
              className="w-full px-4 py-3 rounded-2xl font-extrabold bg-white/10 border border-white/10 shadow-lg hover:bg-white/15"
              onClick={() => router.push("/gestion")}
              type="button"
            >
              📊 Accès Gestion
            </button>

            <button
              onClick={async () => {
                await supabase.auth.signOut();
                router.replace("/login");
                router.refresh();
              }}
              className="w-full px-4 py-3 rounded-2xl font-extrabold bg-white/10 border border-white/10 shadow-lg hover:bg-white/15"
              type="button"
            >
              Déconnexion
            </button>
          </div>
        </div>

        {/* Top bar */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold">
              🔧 Accueil — Réparations
            </h1>
            <p className="text-white/70 mt-1">Alors ? On s&apos;y met ?</p>
          </div>

          <div className="flex-1 max-w-none lg:max-w-md">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="🔎 Recherche (nom, plaque, tel, véhicule…)"
              className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none placeholder:text-white/40"
            />
          </div>

          <button
            onClick={openModal}
            className="w-full lg:w-auto px-4 py-3 rounded-2xl font-extrabold bg-emerald-400 text-slate-950 shadow-lg hover:opacity-90"
            type="button"
          >
            ➕ Créer une réparation
          </button>
        </div>

        {/* Panel mécano */}
        {showMecanoPanel && (
          <div className="mt-4 p-5 rounded-3xl bg-white/5 border border-white/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xl font-extrabold">🔧 Accès Mécano</div>
                <div className="text-white/60 text-sm">
                  Devis • Infos entreprise (sans toucher aux réparations)
                </div>
              </div>
              <button
                onClick={() => setShowMecanoPanel(false)}
                className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 hover:bg-white/15"
                type="button"
              >
                ✖️ Fermer
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => setMecanoTab("devis")}
                className={[
                  "px-3 py-2 rounded-2xl font-extrabold border",
                  mecanoTab === "devis"
                    ? "bg-emerald-400 text-slate-950 border-emerald-300"
                    : "bg-white/10 border-white/10 hover:bg-white/15",
                ].join(" ")}
                type="button"
              >
                🧾 Devis
              </button>

              <button
                onClick={() => setMecanoTab("entreprise")}
                className={[
                  "px-3 py-2 rounded-2xl font-extrabold border",
                  mecanoTab === "entreprise"
                    ? "bg-emerald-400 text-slate-950 border-emerald-300"
                    : "bg-white/10 border-white/10 hover:bg-white/15",
                ].join(" ")}
                type="button"
              >
                🏢 Entreprise
              </button>
            </div>

            {mecanoTab === "devis" && (
              <div className="mt-4 p-4 rounded-2xl bg-black/30 border border-white/10 space-y-4">
                <div>
                  <div className="font-extrabold text-lg">🧾 Nouveau devis</div>
                  <div className="text-white/50 text-xs mt-1">
                    (Template Drive prêt : {TEMPLATE_DEVIS_ID})
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-bold text-white/80">Plaque</div>
                  <input
                    className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none font-bold tracking-wider"
                    placeholder="Ex : AA-123-SS"
                    value={quotePlate}
                    onChange={(e) =>
                      setQuotePlate(normalizePlate(e.target.value))
                    }
                  />
                </div>

                {quotePlate && (
                  <div className="text-sm -mt-1">
                    {quoteClientInfo ? (
                      <div className="text-emerald-400 font-extrabold">
                        ✅ Client trouvé : {quoteClientInfo.name}
                        {quoteClientInfo.vehicle
                          ? ` — ${quoteClientInfo.vehicle}`
                          : ""}
                      </div>
                    ) : (
                      <div className="text-red-400 font-extrabold">
                        ❌ Aucun client trouvé
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-sm font-bold text-white/80">Pièces</div>

                  <div className="grid grid-cols-12 gap-2 text-xs text-white/60 px-1">
                    <div className="col-span-7">Désignation</div>
                    <div className="col-span-2 text-right">Qté</div>
                    <div className="col-span-3 text-right">€ unitaire</div>
                  </div>

                  <div className="space-y-2">
                    {quoteItems.map((item, index) => (
                      <div key={index} className="grid grid-cols-12 gap-2">
                        <input
                          className="col-span-7 px-3 py-2 rounded-xl bg-white/5 border border-white/10"
                          placeholder="Désignation (ex : Plaquettes)"
                          value={item.description}
                          onChange={(e) =>
                            updateQuoteItem(
                              index,
                              "description",
                              e.target.value,
                            )
                          }
                        />
                        <input
                          type="number"
                          className="col-span-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-right"
                          value={item.quantity}
                          onChange={(e) =>
                            updateQuoteItem(index, "quantity", e.target.value)
                          }
                        />
                        <input
                          type="number"
                          className="col-span-3 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-right"
                          value={item.unit_price}
                          onChange={(e) =>
                            updateQuoteItem(index, "unit_price", e.target.value)
                          }
                        />
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={addQuoteItem}
                    className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 hover:bg-white/15"
                    type="button"
                  >
                    ➕ Ajouter une pièce
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="text-sm font-bold text-white/80">
                      Main d’œuvre (€)
                    </div>
                    <input
                      type="number"
                      className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-right"
                      value={laborCost}
                      onChange={(e) => setLaborCost(Number(e.target.value))}
                    />
                  </div>

                  <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                    <div className="flex justify-between text-sm text-white/70">
                      <span>Total pièces</span>
                      <span className="font-bold">
                        {computedPartsTotal.toFixed(2)} €
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-white/70 mt-1">
                      <span>Main d’œuvre</span>
                      <span className="font-bold">
                        {Number(laborCost || 0).toFixed(2)} €
                      </span>
                    </div>
                    <div className="flex justify-between text-base mt-2">
                      <span className="font-extrabold">TOTAL</span>
                      <span className="font-extrabold">
                        {computedTotal.toFixed(2)} €
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button
                    onClick={createQuote}
                    disabled={creating}
                    className={[
                      "w-full px-4 py-3 rounded-2xl font-extrabold transition",
                      creating
                        ? "bg-emerald-300 text-slate-950 opacity-70 cursor-not-allowed"
                        : "bg-emerald-400 text-slate-950 hover:opacity-90",
                    ].join(" ")}
                    type="button"
                  >
                    {creating
                      ? "⏳ Génération en cours..."
                      : "🧾 Générer le devis (PDF)"}
                  </button>

                  <button
                    onClick={sendQuoteEmail}
                    disabled={sending || creating || !quotePlate}
                    className={[
                      "w-full px-4 py-3 rounded-2xl font-extrabold transition",
                      sending || creating || !quotePlate
                        ? "bg-white/10 text-white/40 cursor-not-allowed"
                        : "bg-sky-400 text-slate-950 hover:opacity-90",
                    ].join(" ")}
                    type="button"
                  >
                    {sending
                      ? "⏳ Envoi en cours..."
                      : creating
                        ? "⏳ Attends la génération..."
                        : "📧 Envoyer le devis (dernier PDF)"}
                  </button>
                </div>

                {quoteMessage && (
                  <div className="text-sm text-white/80">{quoteMessage}</div>
                )}
              </div>
            )}

            {mecanoTab === "entreprise" && (
              <div className="mt-4 p-4 rounded-2xl bg-black/30 border border-white/10">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-extrabold">🏢 Infos entreprise</div>
                    <div className="text-white/60 text-sm">
                      Copie en 1 clic ✨
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(companyText);
                      alert("✅ Infos copiées !");
                    }}
                    className="px-4 py-3 rounded-2xl font-extrabold bg-emerald-400 text-slate-950 hover:opacity-90"
                    type="button"
                  >
                    📋 Copier
                  </button>
                </div>

                <pre className="mt-4 text-sm whitespace-pre-wrap bg-black/30 p-4 rounded-2xl border border-white/10">
                  {companyText}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Repairs list */}
        <div className="mt-6 space-y-4">
          {loading && <p className="text-white/70">⏳ Chargement…</p>}

          {!loading && filteredRepairs.length === 0 && (
            <div className="p-5 rounded-2xl bg-white/5 border border-white/10">
              <p className="text-white/80">✅ Aucune réparation en cours.</p>
            </div>
          )}

          {filteredRepairs.map((repair) => {
            const isOpenCard = openId === repair.id;

            return (
              <div
                key={repair.id}
                onClick={() => setOpenId(isOpenCard ? null : repair.id)}
                className={[
                  "p-5 rounded-2xl border shadow-lg cursor-pointer transition-all",
                  repair.status === "en_cours"
                    ? "bg-emerald-400/10 border-amber-300/40"
                    : "bg-white/5 border-white/10",
                ].join(" ")}
                style={
                  repair.status === "en_cours"
                    ? { animation: "pulseBorder 1s infinite" }
                    : undefined
                }
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold">
                      {repair.clients.vehicle_type ?? "Véhicule"} —{" "}
                      {repair.clients.plate}
                    </h2>
                    <p className="text-white/70 text-sm mt-1">
                      {isOpenCard ? "🔽 Détails" : "▶️ Ouvrir"}
                    </p>
                  </div>

                  <div className="text-sm font-bold">
                    {repair.status === "a_faire"
                      ? "🟠 À faire"
                      : repair.status === "en_pause"
                        ? "⏸️ En pause"
                        : "🔵 En cours"}
                  </div>
                </div>

                {isOpenCard && (
                  <div className="mt-4 space-y-2">
                    <p className="text-white/80">
                      🔧 {repair.repair_type ?? "Réparation"}
                    </p>

                    <p className="text-white/70">
                      👤 {repair.clients.first_name ?? ""}{" "}
                      {repair.clients.last_name ?? ""}{" "}
                      {repair.clients.phone
                        ? `— ☎️ ${repair.clients.phone}`
                        : ""}
                    </p>

                    {repair.estimated_duration && (
                      <p className="text-white/60">
                        ⏱️ Durée estimée : {repair.estimated_duration}
                      </p>
                    )}

                    <div className="pt-2 space-y-2">
                      <div className="text-sm font-bold text-white/80">
                        💬 Commentaire mécano
                      </div>
                      <textarea
                        className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none min-h-[90px]"
                        placeholder="Note rapide : pièces à commander, blocage, retour client, etc."
                        value={commentDrafts[repair.id] ?? repair.comment ?? ""}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          setCommentDrafts((prev) => ({
                            ...prev,
                            [repair.id]: e.target.value,
                          }))
                        }
                      />
                      <div className="flex items-center gap-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            saveRepairComment(repair.id);
                          }}
                          disabled={savingCommentId === repair.id}
                          className={[
                            "px-4 py-2 rounded-xl font-bold transition",
                            savingCommentId === repair.id
                              ? "bg-white/10 text-white/40 cursor-not-allowed"
                              : "bg-emerald-400 text-slate-950 hover:opacity-90",
                          ].join(" ")}
                          type="button"
                        >
                          {savingCommentId === repair.id
                            ? "⏳ Enregistrement..."
                            : "💾 Enregistrer"}
                        </button>

                        {commentMsg[repair.id] && (
                          <div className="text-sm text-white/70">
                            {commentMsg[repair.id]}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2">
                      {repair.status === "a_faire" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startRepair(repair.id);
                          }}
                          className="px-3 py-2 rounded-xl bg-sky-400 text-slate-950 font-bold hover:opacity-90"
                          type="button"
                        >
                          🔵 Passer en cours
                        </button>
                      )}

                      {repair.status === "en_cours" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            pauseRepair(repair.id);
                          }}
                          className="px-3 py-2 rounded-xl bg-sky-400 text-slate-950 font-bold hover:opacity-90 inline-flex items-center gap-2"
                          type="button"
                        >
                          ⏸️ Pause
                        </button>
                      )}

                      {repair.status === "en_pause" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            resumeRepair(repair.id);
                          }}
                          className="px-3 py-2 rounded-xl bg-sky-400 text-slate-950 font-bold hover:opacity-90 inline-flex items-center gap-2"
                          type="button"
                        >
                          ▶️ Reprendre
                        </button>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openDevisForPlate(repair.clients.plate);
                        }}
                        className="px-3 py-2 rounded-xl bg-emerald-400 text-slate-950 font-bold hover:opacity-90"
                        type="button"
                      >
                        🧾 Devis
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          finishRepair(repair.id);
                        }}
                        className="px-3 py-2 rounded-xl bg-emerald-400 text-slate-950 font-bold hover:opacity-90"
                        type="button"
                      >
                        🟢 Terminer
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Modal new repair */}
        {isOpen && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4">
            <div className="w-full max-w-xl rounded-3xl bg-slate-900 border border-white/10 shadow-2xl">
              <div className="p-5 border-b border-white/10 flex items-center justify-between">
                <h3 className="text-xl font-extrabold">
                  ➕ Nouvelle réparation
                </h3>
                <button
                  onClick={closeModal}
                  className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15"
                  type="button"
                >
                  ✖️
                </button>
              </div>

              <div className="p-5 space-y-4">
                {formError && (
                  <div className="p-3 rounded-2xl bg-red-500/20 border border-red-400/30 text-red-100">
                    {formError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none"
                    placeholder="👤 Prénom"
                    value={form.first_name}
                    onChange={(e) => updateField("first_name", e.target.value)}
                  />
                  <input
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none"
                    placeholder="👤 Nom"
                    value={form.last_name}
                    onChange={(e) => updateField("last_name", e.target.value)}
                  />
                  <input
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none md:col-span-2"
                    placeholder="🏠 Adresse"
                    value={form.address}
                    onChange={(e) => updateField("address", e.target.value)}
                  />
                  <input
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none"
                    placeholder="📧 Email"
                    value={form.email}
                    onChange={(e) => updateField("email", e.target.value)}
                  />
                  <input
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none"
                    placeholder="☎️ Téléphone"
                    value={form.phone}
                    onChange={(e) => updateField("phone", e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none font-bold tracking-wider"
                    placeholder="🚗 Plaque (ex: AA-123-SS)"
                    value={form.plate}
                    onChange={(e) =>
                      updateField("plate", normalizePlate(e.target.value))
                    }
                  />
                  <input
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none"
                    placeholder="🚙 Type véhicule (ex: Clio 2)"
                    value={form.vehicle_type}
                    onChange={(e) =>
                      updateField("vehicle_type", e.target.value)
                    }
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none"
                    placeholder="🔧 Type réparation (ex: Freins)"
                    value={form.repair_type}
                    onChange={(e) => updateField("repair_type", e.target.value)}
                  />
                  <input
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none"
                    placeholder="⏱️ Durée estimée (ex: 1h)"
                    value={form.estimated_duration}
                    onChange={(e) =>
                      updateField("estimated_duration", e.target.value)
                    }
                  />
                </div>

                <textarea
                  className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none min-h-[90px]"
                  placeholder="💬 Commentaire (optionnel)"
                  value={form.comment}
                  onChange={(e) => updateField("comment", e.target.value)}
                />

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                  <button
                    onClick={closeModal}
                    className="px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/15"
                    type="button"
                  >
                    ↩️ Annuler
                  </button>

                  <button
                    disabled={!canSave || saving}
                    onClick={createRepair}
                    className={[
                      "px-5 py-3 rounded-2xl font-extrabold shadow-lg",
                      canSave && !saving
                        ? "bg-emerald-400 text-slate-950 hover:opacity-90"
                        : "bg-white/10 text-white/40 cursor-not-allowed",
                    ].join(" ")}
                    type="button"
                  >
                    {saving ? "⏳ Création…" : "✅ Créer"}
                  </button>
                </div>

                <p className="text-xs text-white/50">
                  ✅ Minimum requis : Plaque + Type véhicule + Type réparation.
                </p>
              </div>
            </div>
          </div>
        )}

        <style>
          {`
            @keyframes pulseBorder {
              0% { box-shadow: 0 0 0 rgba(16, 185, 129, 0.0); }
              50% { box-shadow: 0 0 18px rgba(16, 185, 129, 0.55); }
              100% { box-shadow: 0 0 0 rgba(16, 185, 129, 0.0); }
            }
          `}
        </style>
      </div>
    </div>
  );
}
