"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ReactNode } from "react";

type TabKey = "clients" | "devis" | "factures" | "parametres";

type ClientRow = {
  id: string;
  created_at: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  plate: string | null;
  vehicle_type: string | null;
  address: string | null;
};

type ClientEditDraft = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  plate: string;
  vehicle_type: string;
  address: string;
};

type QuoteItemDbRow = {
  id: string;
  description: string | null;
  unit_price: number | null;
  quantity: number | null;
};

type QuoteStatus =
  | "brouillon"
  | "a_envoyer"
  | "envoye"
  | "remis"
  | "accepte"
  | "refuse";

type QuoteRow = {
  id: string;
  quote_number: number;
  client_id: string | null;

  status: QuoteStatus | string | null;

  doc_url: string | null;
  pdf_url: string | null;

  doc_id: string | null;
  folder_id: string | null;
  pdf_file_id: string | null;

  total_amount: number | null;

  pdf_stale: boolean | null;

  created_at: string;
  labor_cost: number | null;

  clients: {
    first_name: string | null;
    last_name: string | null;
    plate: string | null;
    email: string | null;
  } | null;

  quote_items: QuoteItemDbRow[];
};

type QuoteEditDraftItem = {
  id?: string;
  description: string;
  unit_price: number;
  quantity: number;
};

type InvoiceStatus = "brouillon" | "a_envoyer" | "envoye" | "payee" | "annule";

type InvoiceItemDbRow = {
  id: string;
  description: string | null;
  unit_price: number | null;
  quantity: number | null;
};

type InvoiceRow = {
  id: string;
  invoice_number: number;
  client_id: string | null;
  quote_id: string | null;

  status: InvoiceStatus | string | null;
  paid: boolean | null;

  doc_url: string | null;
  pdf_url: string | null;

  doc_id: string | null;
  folder_id: string | null;
  pdf_file_id: string | null;

  total_amount: number | null;
  labor_cost: number | null;

  // 🔥 comme pour les devis (il faut ce flag en DB idéalement)
  pdf_stale: boolean | null;

  created_at: string;

  clients: ClientMini | null;

  invoice_items: InvoiceItemDbRow[];
};

type InvoiceEditDraftItem = {
  id?: string;
  description: string;
  unit_price: number;
  quantity: number;
};

type ClientMini = {
  first_name: string | null;
  last_name: string | null;
  plate: string | null;
  email: string | null;
};

type MaybeOne<T> = T | T[] | null | undefined;

function one<T>(v: MaybeOne<T>): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function safeStr(v: string | null | undefined) {
  return (v ?? "").toString();
}

function cn(...a: Array<string | false | null | undefined>) {
  return a.filter(Boolean).join(" ");
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={cn(
        "px-3 py-2 rounded-2xl font-extrabold border transition",
        active
          ? "bg-emerald-400 text-slate-950 border-emerald-300"
          : "bg-white/10 border-white/10 hover:bg-white/15",
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function PlateBadge({ plate }: { plate: string | null | undefined }) {
  return (
    <span className="inline-flex items-center px-3 py-1 rounded-full bg-white/10 border border-white/10 font-mono font-bold tracking-wider">
      {plate || "—"}
    </span>
  );
}

function statusLabel(s: string | null | undefined) {
  const v = (s ?? "").toLowerCase();
  if (v === "brouillon") return "📝 Brouillon";
  if (v === "a_envoyer") return "🟠 À envoyer";
  if (v === "envoye") return "✉️ Envoyé (email)";
  if (v === "remis") return "🤝 Remis";
  if (v === "accepte") return "✅ Accepté";
  if (v === "refuse") return "❌ Refusé";
  if (v === "annule") return "🚫 Annulé";
  return s || "—";
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// YYYY-MM-DD
function monthStartISODate(year: number, month0: number) {
  return `${year}-${pad2(month0 + 1)}-01`;
}

// YYYY-MM-DD (début du mois suivant)
function nextMonthStartISODate(year: number, month0: number) {
  const d = new Date(Date.UTC(year, month0 + 1, 1));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${pad2(m)}-01`;
}

function extractErr(e: any) {
  // SupabaseError a parfois des props non énumérables → on force un objet simple
  return {
    name: e?.name,
    message: e?.message,
    code: e?.code,
    details: e?.details,
    hint: e?.hint,
    status: e?.status,
    raw: String(e),
  };
}

function ParametresSection() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [nextInvoice, setNextInvoice] = useState<number>(1);
  const [nextQuote, setNextQuote] = useState<number>(1);

  const [draftInvoice, setDraftInvoice] = useState<number>(1);
  const [draftQuote, setDraftQuote] = useState<number>(1);

  const loadCounters = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const { data, error } = await supabase
        .from("numbering_counters")
        .select("key, next_value")
        .in("key", ["invoice", "quote"]);

      if (error) throw error;

      const inv =
        (data ?? []).find((x) => x.key === "invoice")?.next_value ?? 1;
      const quo = (data ?? []).find((x) => x.key === "quote")?.next_value ?? 1;

      setNextInvoice(Number(inv));
      setNextQuote(Number(quo));
      setDraftInvoice(Number(inv));
      setDraftQuote(Number(quo));
    } catch (e: any) {
      setMsg(`❌ ${e?.message ?? "Erreur chargement compteurs"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCounters();
  }, [loadCounters]);

  async function save() {
    if (draftInvoice < nextInvoice) {
      setMsg("⚠️ Le numéro facture est inférieur au prochain existant.");
      return;
    }

    if (draftQuote < nextQuote) {
      setMsg("⚠️ Le numéro devis est inférieur au prochain existant.");
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      const a = await supabase.rpc("set_counter", {
        p_key: "invoice",
        p_next: Number(draftInvoice || 1),
      });
      if (a.error) throw a.error;

      const b = await supabase.rpc("set_counter", {
        p_key: "quote",
        p_next: Number(draftQuote || 1),
      });
      if (b.error) throw b.error;

      setMsg(
        `✅ Prochaine facture : F-${String(draftInvoice).padStart(6, "0")}`,
      );

      await loadCounters();
      setMsg("✅ Compteurs mis à jour !");
    } catch (e: any) {
      setMsg(`❌ ${e?.message ?? "Erreur sauvegarde compteurs"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-5 rounded-3xl bg-white/5 border border-white/10">
      <div className="text-xl font-extrabold">⚙️ Paramètres</div>
      <div className="text-white/60 mt-1">
        Compteurs globaux (devis / factures)
      </div>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl bg-black/30 border border-white/10">
          <div className="text-sm text-white/70 font-bold">
            🧾 Prochain numéro facture
          </div>
          <div className="text-2xl font-extrabold mt-2">
            F-{String(nextInvoice).padStart(6, "0")}
          </div>

          <div className="mt-4 text-xs text-white/50 mb-1">
            Reprendre factures à partir de…
          </div>
          <input
            type="number"
            step={1}
            className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none text-right font-extrabold"
            value={draftInvoice}
            onChange={(e) => setDraftInvoice(Number(e.target.value))}
            min={1}
          />
        </div>

        <div className="p-4 rounded-2xl bg-black/30 border border-white/10">
          <div className="text-sm text-white/70 font-bold">
            🧾 Prochain numéro devis
          </div>
          <div className="text-2xl font-extrabold mt-2">
            D-{String(nextQuote).padStart(6, "0")}
          </div>

          <div className="mt-4 text-xs text-white/50 mb-1">
            Reprendre devis à partir de…
          </div>
          <input
            type="number"
            className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none text-right font-extrabold"
            value={draftQuote}
            onChange={(e) => setDraftQuote(Number(e.target.value))}
            min={1}
          />
        </div>
      </div>

      {msg && <div className="mt-4 text-sm text-white/80">{msg}</div>}

      <div className="mt-5 flex gap-2">
        <button
          onClick={loadCounters}
          className="px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/15 font-extrabold border border-white/10"
          type="button"
          disabled={loading}
        >
          {loading ? "⏳" : "🔄"} Rafraîchir
        </button>
        <button
          onClick={() => {
            setDraftInvoice(nextInvoice);
            setDraftQuote(nextQuote);
          }}
          className="px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/15 font-extrabold border border-white/10"
          type="button"
        >
          ♻️ Réinitialiser
        </button>

        <button
          onClick={save}
          className={cn(
            "px-5 py-3 rounded-2xl font-extrabold shadow-lg",
            loading
              ? "bg-white/10 text-white/40 cursor-not-allowed"
              : "bg-emerald-400 text-slate-950 hover:opacity-90",
          )}
          type="button"
          disabled={loading}
        >
          {loading ? "⏳ Sauvegarde…" : "✅ Enregistrer"}
        </button>
      </div>

      <div className="mt-3 text-xs text-white/50">
        💡 Exemple : mettre 100 → la prochaine facture sera F-000100.
      </div>
    </div>
  );
}

export default function GestionPage() {
  const [tab, setTab] = useState<TabKey>("factures");

  // ----- CLIENTS -----
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientRow | null>(null);
  const [editDraft, setEditDraft] = useState<ClientEditDraft>({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    plate: "",
    vehicle_type: "",
    address: "",
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editMsg, setEditMsg] = useState<string | null>(null);

  const [clientSearch, setClientSearch] = useState("");

  // ----- DEVIS -----
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quotesError, setQuotesError] = useState<string | null>(null);

  const [loadingRegen, setLoadingRegen] = useState<Record<string, boolean>>({});
  const [loadingSend, setLoadingSend] = useState<Record<string, boolean>>({});
  const [loadingConvert, setLoadingConvert] = useState<Record<string, boolean>>(
    {},
  );

  // modal edit devis
  const [quoteEditOpen, setQuoteEditOpen] = useState(false);
  const [quoteEditing, setQuoteEditing] = useState<QuoteRow | null>(null);
  const [quoteEditSaving, setQuoteEditSaving] = useState(false);
  const [quoteEditMsg, setQuoteEditMsg] = useState<string | null>(null);
  const [quoteEditLabor, setQuoteEditLabor] = useState<number>(0);
  const [quoteEditItems, setQuoteEditItems] = useState<QuoteEditDraftItem[]>(
    [],
  );

  // ----- FACTURES -----
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState("");

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth()); // 0-11

  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  type InvoiceKpis = {
    ca_month: number;
    ca_previous_month: number;
    ca_year: number;
  };

  const [invoiceKpis, setInvoiceKpis] = useState<InvoiceKpis>({
    ca_month: 0,
    ca_previous_month: 0,
    ca_year: 0,
  });
  const [loadingInvRegen, setLoadingInvRegen] = useState<
    Record<string, boolean>
  >({});
  const [loadingInvSend, setLoadingInvSend] = useState<Record<string, boolean>>(
    {},
  );

  const [invoiceEditOpen, setInvoiceEditOpen] = useState(false);
  const [invoiceEditing, setInvoiceEditing] = useState<InvoiceRow | null>(null);
  const [invoiceEditSaving, setInvoiceEditSaving] = useState(false);
  const [invoiceEditMsg, setInvoiceEditMsg] = useState<string | null>(null);
  const [invoiceEditLabor, setInvoiceEditLabor] = useState<number>(0);
  const [invoiceEditItems, setInvoiceEditItems] = useState<
    InvoiceEditDraftItem[]
  >([]);
  const invoicesReqIdRef = useRef(0);

  function monthLabel(m: number) {
    const names = [
      "janvier",
      "février",
      "mars",
      "avril",
      "mai",
      "juin",
      "juillet",
      "août",
      "septembre",
      "octobre",
      "novembre",
      "décembre",
    ];
    return names[m] ?? String(m + 1);
  }

  const filteredInvoices = useMemo(() => {
    const q = invoiceSearch.toLowerCase();

    let list = invoices;

    if (onlyUnpaid) list = list.filter((inv) => !Boolean(inv.paid));

    if (!q) return list;

    return list.filter((inv) => {
      const full = [
        inv.invoice_number,
        inv.client_id,
        inv.status,
        inv.total_amount,
      ]
        .join(" ")
        .toLowerCase();

      return full.includes(q);
    });
  }, [invoiceSearch, invoices, onlyUnpaid]);

  function setRowBusy(
    setter: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
    id: string,
    value: boolean,
  ) {
    setter((prev) => ({ ...prev, [id]: value }));
  }

  const fetchLatestInvoices = useCallback(
    async (year?: number, month0?: number) => {
      const y = Number.isFinite(year as number)
        ? (year as number)
        : selectedYear;
      const m = Number.isFinite(month0 as number)
        ? (month0 as number)
        : selectedMonth;

      const reqId = ++invoicesReqIdRef.current;
      setInvoicesLoading(true);

      // ✅ timestamps "neutres" (SANS Z)
      const startDate = monthStartISODate(y, m);
      const endDate = nextMonthStartISODate(y, m);
      const startTs = `${startDate}T00:00:00`;
      const endTs = `${endDate}T00:00:00`;

      try {
        // 1) KPI via RPC → NON BLOQUANT
        try {
          const { data: kpiData, error: kpiErr } = await supabase.rpc(
            "get_invoice_kpis",
            { p_year: y, p_month: m + 1 },
          );

          if (kpiErr) throw kpiErr;
          if (reqId !== invoicesReqIdRef.current) return;

          setInvoiceKpis({
            ca_month: Number((kpiData as any)?.ca_month || 0),
            ca_previous_month: Number((kpiData as any)?.ca_previous_month || 0),
            ca_year: Number((kpiData as any)?.ca_year || 0),
          });
        } catch (kpiE: any) {
          console.error("get_invoice_kpis failed:", {
            y,
            m,
            ...extractErr(kpiE),
          });
          if (reqId !== invoicesReqIdRef.current) return;
          setInvoiceKpis({ ca_month: 0, ca_previous_month: 0, ca_year: 0 });
        }

        // 2) Liste factures
        const { data, error } = await supabase
          .from("invoices")
          .select(
            `
    id,
    invoice_number,
    client_id,
    quote_id,
    status,
    paid,
    doc_url,
    pdf_url,
    doc_id,
    folder_id,
    pdf_file_id,
    total_amount,
    labor_cost,
    pdf_stale,
    created_at,

    clients:clients!invoices_client_id_fkey ( first_name, last_name, plate, email ),
    invoice_items:invoice_items!invoice_items_invoice_id_fkey ( id, description, unit_price, quantity )
  `,
          )
          .gte("created_at", startTs)
          .lt("created_at", endTs)
          .order("created_at", { ascending: false });

        if (error) throw error;
        if (reqId !== invoicesReqIdRef.current) return;

        const rows = (data ?? []) as any[];

        const normalized: InvoiceRow[] = rows.map((r) => ({
          ...r,
          clients: one<ClientMini>(r.clients),
          invoice_items: Array.isArray(r.invoice_items) ? r.invoice_items : [],
        }));

        setInvoices(normalized);
      } catch (e: any) {
        if (reqId !== invoicesReqIdRef.current) return;

        console.error("fetchLatestInvoices failed:", {
          y,
          m,
          startTs,
          endTs,
          ...extractErr(e),
        });

        setInvoices([]);
        // KPI déjà gérés au-dessus (on ne reset pas forcément ici)
      } finally {
        if (reqId === invoicesReqIdRef.current) setInvoicesLoading(false);
      }
    },
    [selectedYear, selectedMonth],
  );

  function openEditClient(c: ClientRow) {
    setEditingClient(c);
    setEditDraft({
      first_name: safeStr(c.first_name),
      last_name: safeStr(c.last_name),
      email: safeStr(c.email),
      phone: safeStr(c.phone),
      plate: safeStr(c.plate),
      vehicle_type: safeStr(c.vehicle_type),
      address: safeStr(c.address),
    });
    setEditMsg(null);
    setEditOpen(true);
  }

  function closeEditClient() {
    if (editSaving) return;
    setEditOpen(false);
    setEditingClient(null);
    setEditMsg(null);
  }

  async function saveClientEdit() {
    if (!editingClient) return;

    setEditSaving(true);
    setEditMsg(null);

    try {
      const payload = {
        first_name: editDraft.first_name.trim() || null,
        last_name: editDraft.last_name.trim() || null,
        email: editDraft.email.trim() || null,
        phone: editDraft.phone.trim() || null,
        plate: editDraft.plate.trim() || null,
        vehicle_type: editDraft.vehicle_type.trim() || null,
        address: editDraft.address.trim() || null,
      };

      const { error } = await supabase
        .from("clients")
        .update(payload)
        .eq("id", editingClient.id);

      if (error) throw error;

      setEditMsg("✅ Client mis à jour !");
      await fetchLatestClients();
      setTimeout(() => {
        setEditOpen(false);
        setEditingClient(null);
      }, 300);
    } catch (e: any) {
      setEditMsg(`❌ ${e?.message ?? "Erreur mise à jour"}`);
    } finally {
      setEditSaving(false);
    }
  }

  // ✅ ouvrir édition devis
  function openEditQuote(q: QuoteRow) {
    setQuoteEditing(q);
    setQuoteEditMsg(null);
    setQuoteEditLabor(Number(q.labor_cost || 0));
    setQuoteEditItems(
      (q.quote_items ?? []).map((it) => ({
        id: it.id,
        description: safeStr(it.description),
        unit_price: Number(it.unit_price || 0),
        quantity: Number(it.quantity || 0),
      })),
    );
    if ((q.quote_items ?? []).length === 0) {
      setQuoteEditItems([{ description: "", unit_price: 0, quantity: 1 }]);
    }
    setQuoteEditOpen(true);
  }

  function closeEditQuote() {
    if (quoteEditSaving) return;
    setQuoteEditOpen(false);
    setQuoteEditing(null);
    setQuoteEditMsg(null);
  }

  function addEditQuoteItem() {
    setQuoteEditItems((prev) => [
      ...prev,
      { description: "", unit_price: 0, quantity: 1 },
    ]);
  }

  function updateEditQuoteItem(
    index: number,
    field: "description" | "unit_price" | "quantity",
    value: string,
  ) {
    setQuoteEditItems((prev) =>
      prev.map((it, i) =>
        i === index
          ? {
              ...it,
              [field]: field === "description" ? value : Number(value),
            }
          : it,
      ),
    );
  }

  function removeEditQuoteItem(index: number) {
    setQuoteEditItems((prev) => prev.filter((_, i) => i !== index));
  }

  function openEditInvoice(inv: InvoiceRow) {
    console.log("OPEN INVOICE", inv.id);
    setInvoiceEditing(inv);
    setInvoiceEditOpen(true);
    setInvoiceEditMsg(null);
    setInvoiceEditLabor(Number(inv.labor_cost || 0));
    setInvoiceEditItems(
      (inv.invoice_items ?? []).map((it) => ({
        id: it.id,
        description: safeStr(it.description),
        unit_price: Number(it.unit_price || 0),
        quantity: Number(it.quantity || 0),
      })),
    );

    if ((inv.invoice_items ?? []).length === 0) {
      setInvoiceEditItems([{ description: "", unit_price: 0, quantity: 1 }]);
    }
  }

  function closeEditInvoice() {
    if (invoiceEditSaving) return;
    setInvoiceEditOpen(false);
    setInvoiceEditing(null);
    setInvoiceEditMsg(null);
  }

  function addEditInvoiceItem() {
    setInvoiceEditItems((p) => [
      ...p,
      { description: "", unit_price: 0, quantity: 1 },
    ]);
  }

  function updateEditInvoiceItem(
    index: number,
    field: "description" | "unit_price" | "quantity",
    value: string,
  ) {
    setInvoiceEditItems((prev) =>
      prev.map((it, i) =>
        i === index
          ? { ...it, [field]: field === "description" ? value : Number(value) }
          : it,
      ),
    );
  }

  function removeEditInvoiceItem(index: number) {
    setInvoiceEditItems((p) => p.filter((_, i) => i !== index));
  }

  const invoiceEditPartsTotal = useMemo(() => {
    return invoiceEditItems.reduce((sum, it) => {
      const up = Number(it.unit_price || 0);
      const qt = Number(it.quantity || 0);
      if (!it.description.trim()) return sum;
      return sum + up * qt;
    }, 0);
  }, [invoiceEditItems]);

  const invoiceEditTotal = useMemo(() => {
    return invoiceEditPartsTotal + Number(invoiceEditLabor || 0);
  }, [invoiceEditPartsTotal, invoiceEditLabor]);

  const editPartsTotal = useMemo(() => {
    return quoteEditItems.reduce((sum, it) => {
      const up = Number(it.unit_price || 0);
      const qt = Number(it.quantity || 0);
      if (!it.description.trim()) return sum;
      return sum + up * qt;
    }, 0);
  }, [quoteEditItems]);

  const editTotal = useMemo(() => {
    return editPartsTotal + Number(quoteEditLabor || 0);
  }, [editPartsTotal, quoteEditLabor]);

  async function saveQuoteEdit() {
    if (!quoteEditing) return;
    setQuoteEditSaving(true);
    setQuoteEditMsg(null);

    try {
      const { error: updQuoteErr } = await supabase
        .from("quotes")
        .update({
          labor_cost: Number(quoteEditLabor || 0),
          total_amount: Number(editTotal || 0),
          status: (quoteEditing.status || "brouillon") as any,
          pdf_stale: true,
        })
        .eq("id", quoteEditing.id);

      if (updQuoteErr) throw updQuoteErr;

      await supabase
        .from("quote_items")
        .delete()
        .eq("quote_id", quoteEditing.id);

      const toInsert = quoteEditItems
        .filter((it) => it.description.trim())
        .map((it) => ({
          quote_id: quoteEditing.id,
          description: it.description.trim(),
          unit_price: Number(it.unit_price || 0),
          quantity: Number(it.quantity || 0),
        }));

      if (toInsert.length) {
        const { error: insErr } = await supabase
          .from("quote_items")
          .insert(toInsert);
        if (insErr) throw insErr;
      }

      setQuoteEditMsg("✅ Devis mis à jour !");
      await fetchLatestQuotes();
      setTimeout(() => closeEditQuote(), 250);
    } catch (e: any) {
      setQuoteEditMsg(`❌ ${e?.message ?? "Erreur sauvegarde devis"}`);
    } finally {
      setQuoteEditSaving(false);
    }
  }

  async function updateQuoteStatus(quoteId: string, newStatus: QuoteStatus) {
    const { error } = await supabase
      .from("quotes")
      .update({ status: newStatus })
      .eq("id", quoteId);

    if (error) {
      alert("❌ Erreur statut: " + error.message);
      return;
    }
    await fetchLatestQuotes();
  }

  async function regeneratePdfFromGestion(q: QuoteRow) {
    setRowBusy(setLoadingRegen, q.id, true);

    try {
      if (!q.doc_id || !q.folder_id) {
        alert("❌ doc_id ou folder_id manquant");
        return;
      }

      const partsTotal = (q.quote_items ?? []).reduce((sum, it) => {
        const up = Number(it.unit_price || 0);
        const qt = Number(it.quantity || 0);
        return sum + up * qt;
      }, 0);
      const labor = Number(q.labor_cost || 0);
      const total = Number(q.total_amount ?? partsTotal + labor);

      const rewritePayload = {
        action: "rewrite_quote_pdf",
        payload: {
          docId: q.doc_id,
          folderId: q.folder_id,
          fileNameBase: `Devis ${q.quote_number}`,
          quoteNumber: q.quote_number,
          date: new Date().toISOString().slice(0, 10),
          client: {
            firstName: q.clients?.first_name || "",
            lastName: q.clients?.last_name || "",
            email: q.clients?.email || "",
            phone: "",
            address: "",
            plate: q.clients?.plate || "",
            vehicleType: "",
          },
          items: (q.quote_items ?? []).map((it) => ({
            designation: safeStr(it.description),
            qty: Number(it.quantity || 0),
            unitPrice: Number(it.unit_price || 0),
          })),
          labor,
          totals: { partsTotal, total },
        },
      };

      let result: any = null;
      {
        const response = await fetch("/api/apps-script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rewritePayload),
        });
        result = await response.json();
      }

      if (!result?.ok) {
        const fallbackPayload = {
          action: "regenerate_quote_pdf",
          payload: {
            docId: q.doc_id,
            folderId: q.folder_id,
            fileNameBase: `Devis ${q.quote_number}`,
            quoteNumber: q.quote_number,
          },
        };

        const response = await fetch("/api/apps-script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fallbackPayload),
        });

        const fallback = await response.json();
        if (!fallback.ok) {
          throw new Error(
            fallback.error ?? "Apps Script: erreur génération PDF",
          );
        }
        result = fallback;
      }

      const { error } = await supabase
        .from("quotes")
        .update({
          pdf_url: result.pdfUrl,
          pdf_file_id: result.pdfFileId,
          pdf_stale: false,
        })
        .eq("id", q.id);

      if (error) throw error;

      await fetchLatestQuotes();
      if (result.pdfUrl) window.open(result.pdfUrl, "_blank");
    } catch (e: any) {
      alert("❌ " + (e?.message ?? "Failed to fetch"));
    } finally {
      setRowBusy(setLoadingRegen, q.id, false);
    }
  }

  async function ensureFreshInvoicePdf(inv: InvoiceRow): Promise<InvoiceRow> {
    const need =
      Boolean(inv.pdf_stale) ||
      !inv.pdf_file_id ||
      !inv.pdf_url ||
      !inv.doc_id ||
      !inv.folder_id;

    if (!need) return inv;

    await regenerateInvoicePdfFromGestion(inv);

    const { data, error } = await supabase
      .from("invoices")
      .select(
        `
        id, invoice_number, client_id, quote_id, status, paid,
        doc_url, pdf_url, doc_id, folder_id, pdf_file_id,
        total_amount, labor_cost, pdf_stale, created_at,
        clients:clients!invoices_client_id_fkey ( first_name, last_name, plate, email ),
        invoice_items:invoice_items!invoice_items_invoice_id_fkey ( id, description, unit_price, quantity )
      `,
      )
      .eq("id", inv.id)
      .single();

    if (error) {
      console.error("invoices select error", error);
      throw error;
    }

    const row = data as any;

    const normalized: InvoiceRow = {
      ...row,
      clients: one<ClientMini>(row.clients),
      invoice_items: Array.isArray(row.invoice_items) ? row.invoice_items : [],
    };

    return normalized;
  }

  async function sendQuoteFromGestion(q: QuoteRow) {
    setRowBusy(setLoadingSend, q.id, true);

    try {
      const email = q.clients?.email || "";
      if (!email) {
        alert("⚠️ Le client n’a pas d’email.");
        return;
      }

      const fresh = await ensureFreshQuotePdf(q);

      if (!fresh.pdf_file_id) {
        alert(
          "❌ Impossible d’envoyer : pdf_file_id manquant même après régénération.",
        );
        return;
      }

      const payload = {
        action: "send_quote_email",
        payload: {
          toEmail: email,
          quoteNumber: fresh.quote_number,
          pdfFileId: fresh.pdf_file_id,
        },
      };

      const response = await fetch("/api/apps-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!result.ok) {
        alert("❌ Apps Script: " + (result.error ?? "Erreur inconnue"));
        return;
      }

      if (result.emailSent) {
        await updateQuoteStatus(fresh.id, "remis");
        alert("✅ Email envoyé !");
      } else {
        alert(
          "⚠️ Email non envoyé: " + (result.emailError ?? "raison inconnue"),
        );
      }
    } catch (e: any) {
      alert("❌ " + (e?.message ?? "Erreur envoi"));
    } finally {
      setRowBusy(setLoadingSend, q.id, false);
    }
  }

  async function toggleInvoicePaid(inv: InvoiceRow, nextPaid: boolean) {
    try {
      if (!inv.doc_id || !inv.folder_id) {
        alert("❌ doc_id ou folder_id manquant sur la facture");
        return;
      }

      const nextStatus = nextPaid ? "payee" : "envoye";

      const { error: updateErr } = await supabase
        .from("invoices")
        .update({
          paid: nextPaid,
          status: nextPaid ? "payee" : inv.status,
          pdf_stale: true,
        })
        .eq("id", inv.id);

      if (updateErr) throw updateErr;

      const payload = {
        action: "regenerate_invoice_pdf",
        payload: {
          docId: inv.doc_id,
          folderId: inv.folder_id,
          paid: nextPaid,
          fileNameBase: `Facture ${String(inv.invoice_number).padStart(6, "0")}`,
        },
      };

      const response = await fetch("/api/apps-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!result.ok) throw new Error(result.error ?? "Erreur Apps Script");

      const { error: pdfErr } = await supabase
        .from("invoices")
        .update({
          pdf_url: result.pdfUrl,
          pdf_file_id: result.pdfFileId,
        })
        .eq("id", inv.id);

      if (pdfErr) throw pdfErr;

      await fetchLatestInvoices();
    } catch (e: any) {
      alert("❌ Paiement : " + (e?.message ?? "Erreur inconnue"));
    }
  }

  async function deleteQuote(q: QuoteRow) {
    if (!confirm(`Supprimer le devis #${q.quote_number} ?`)) return;

    try {
      await supabase.from("quote_items").delete().eq("quote_id", q.id);

      const { error } = await supabase.from("quotes").delete().eq("id", q.id);
      if (error) throw error;

      await fetchLatestQuotes();
    } catch (e: any) {
      alert("❌ Erreur suppression : " + (e?.message ?? "Erreur"));
    }
  }

  const INVOICE_TEMPLATE_ID = "1OafmqnpTgBqwAGsxA0BWlc7TJ_OKvPFvsi1d4LznPGY";

  async function convertQuoteToInvoice(q: QuoteRow) {
    setRowBusy(setLoadingConvert, q.id, true);

    try {
      if (!q.client_id) {
        alert("❌ client_id manquant sur ce devis (quotes.client_id).");
        return;
      }
      if (!q.clients) {
        alert("❌ Client manquant sur ce devis.");
        return;
      }
      if (!q.folder_id) {
        alert("❌ folder_id manquant (dossier Devis & Factures).");
        return;
      }

      const { data: numData, error: numErr } = await supabase.rpc(
        "generate_invoice_number",
      );
      if (numErr) throw numErr;

      const invoiceNumber = Number(numData);
      if (!Number.isFinite(invoiceNumber))
        throw new Error("Numéro facture invalide");

      const partsTotal = (q.quote_items ?? []).reduce((sum, it) => {
        const up = Number(it.unit_price || 0);
        const qt = Number(it.quantity || 0);
        return sum + up * qt;
      }, 0);
      const labor = Number(q.labor_cost || 0);
      const total = Number(q.total_amount ?? partsTotal + labor);

      const { data: invInsert, error: invErr } = await supabase
        .from("invoices")
        .insert({
          invoice_number: invoiceNumber,
          client_id: q.client_id,
          quote_id: q.id,
          status: "brouillon",
          labor_cost: labor,
          total_amount: total,
        })
        .select("id")
        .single();

      if (invErr) throw invErr;

      const invoiceId = invInsert.id as string;

      const itemsToInsert = (q.quote_items ?? [])
        .filter((it) => safeStr(it.description).trim())
        .map((it) => ({
          invoice_id: invoiceId,
          description: safeStr(it.description).trim(),
          unit_price: Number(it.unit_price || 0),
          quantity: Number(it.quantity || 0),
        }));

      if (itemsToInsert.length) {
        const { error: itErr } = await supabase
          .from("invoice_items")
          .insert(itemsToInsert);
        if (itErr) throw itErr;
      }

      const payload = {
        action: "generate_invoice",
        payload: {
          templateId: INVOICE_TEMPLATE_ID,
          folderId: q.folder_id,
          invoiceNumber: String(invoiceNumber),
          quoteNumber: String(q.quote_number),
          dateJour: new Date().toISOString().slice(0, 10),
          client: {
            firstName: q.clients.first_name || "",
            lastName: q.clients.last_name || "",
            email: q.clients.email || "",
            plate: q.clients.plate || "",
            address: "",
            phone: "",
            vehicleType: "",
          },
          items: (q.quote_items ?? []).map((it) => ({
            designation: safeStr(it.description),
            qty: Number(it.quantity || 0),
            unitPrice: Number(it.unit_price || 0),
          })),
          labor,
          totals: { partsTotal, total },
        },
      };

      const res = await fetch("/api/apps-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await res.json();
      if (!result.ok)
        throw new Error(
          result.error ?? "Apps Script: erreur génération facture",
        );

      const { error: upErr } = await supabase
        .from("invoices")
        .update({
          doc_id: result.docId,
          folder_id: result.folderId || q.folder_id,
          doc_url: result.docUrl,
          pdf_url: result.pdfUrl,
          pdf_file_id: result.pdfFileId,
        })
        .eq("id", invoiceId);

      if (upErr) throw upErr;

      if (result.pdfUrl) window.open(result.pdfUrl, "_blank");
      alert(`✅ Facture F-${String(invoiceNumber).padStart(6, "0")} créée !`);
    } catch (e: any) {
      alert("❌ Conversion facture: " + (e?.message ?? "Erreur"));
    } finally {
      setRowBusy(setLoadingConvert, q.id, false);
    }
  }

  async function saveInvoiceEdits() {
    if (!invoiceEditing) return;

    setInvoiceEditSaving(true);
    setInvoiceEditMsg(null);

    try {
      const invoiceId = invoiceEditing.id;

      // 1) Nettoyage lignes existantes
      const { error: delErr } = await supabase
        .from("invoice_items")
        .delete()
        .eq("invoice_id", invoiceId);
      if (delErr) throw delErr;

      // 2) Réinsérer les lignes (non vides)
      const toInsert = invoiceEditItems
        .filter((it) => it.description.trim())
        .map((it) => ({
          invoice_id: invoiceId,
          description: it.description.trim(),
          unit_price: Number(it.unit_price || 0),
          quantity: Number(it.quantity || 0),
        }));

      if (toInsert.length > 0) {
        const { error: insErr } = await supabase
          .from("invoice_items")
          .insert(toInsert);
        if (insErr) throw insErr;
      }

      // 3) Recalcul total
      const partsTotal = toInsert.reduce(
        (acc, it) => acc + it.unit_price * it.quantity,
        0,
      );
      const labor = Number(invoiceEditLabor || 0);
      const total = partsTotal + labor;

      // 4) Update invoice + pdf_stale
      const { error: updErr } = await supabase
        .from("invoices")
        .update({
          labor_cost: labor,
          total_amount: total,
          pdf_stale: true,
        })
        .eq("id", invoiceId);

      if (updErr) throw updErr;

      setInvoiceEditMsg("✅ Facture mise à jour !");
      await fetchLatestInvoices(selectedYear, selectedMonth);
      setTimeout(() => closeEditInvoice(), 250);
    } catch (e: any) {
      setInvoiceEditMsg(`❌ ${e?.message ?? "Erreur sauvegarde facture"}`);
    } finally {
      setInvoiceEditSaving(false);
    }
  }

  async function updateInvoiceStatus(
    invoiceId: string,
    newStatus: InvoiceStatus,
  ) {
    const { error } = await supabase
      .from("invoices")
      .update({ status: newStatus })
      .eq("id", invoiceId);

    if (error) {
      alert("❌ Erreur statut facture: " + error.message);
      return;
    }
    await fetchLatestInvoices();
  }

  async function regenerateInvoicePdfFromGestion(inv: InvoiceRow) {
    setRowBusy(setLoadingInvRegen, inv.id, true);

    try {
      if (!inv.doc_id || !inv.folder_id) {
        alert("❌ doc_id ou folder_id manquant sur la facture");
        return;
      }

      const partsTotal = (inv.invoice_items ?? []).reduce((sum, it) => {
        const up = Number(it.unit_price || 0);
        const qt = Number(it.quantity || 0);
        return sum + up * qt;
      }, 0);

      const labor = Number(inv.labor_cost || 0);
      const total = Number(inv.total_amount ?? partsTotal + labor);

      // 1) tentative rewrite (doc + pdf)
      const rewritePayload = {
        action: "rewrite_invoice_pdf",
        payload: {
          docId: inv.doc_id,
          folderId: inv.folder_id,
          fileNameBase: `Facture ${String(inv.invoice_number).padStart(6, "0")}`,
          invoiceNumber: inv.invoice_number,
          date: new Date().toISOString().slice(0, 10),
          paid: Boolean(inv.paid),
          client: {
            firstName: inv.clients?.first_name || "",
            lastName: inv.clients?.last_name || "",
            email: inv.clients?.email || "",
            plate: inv.clients?.plate || "",
            address: "",
            phone: "",
            vehicleType: "",
          },
          items: (inv.invoice_items ?? []).map((it) => ({
            designation: safeStr(it.description),
            qty: Number(it.quantity || 0),
            unitPrice: Number(it.unit_price || 0),
          })),
          labor,
          totals: { partsTotal, total },
        },
      };

      let result: any = null;

      const r1 = await fetch("/api/apps-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rewritePayload),
      });
      result = await r1.json();

      // 2) fallback simple regen si action pas dispo
      if (!result?.ok) {
        const fallbackPayload = {
          action: "regenerate_invoice_pdf",
          payload: {
            docId: inv.doc_id,
            folderId: inv.folder_id,
            paid: Boolean(inv.paid),
            fileNameBase: `Facture ${String(inv.invoice_number).padStart(6, "0")}`,
          },
        };

        const r2 = await fetch("/api/apps-script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fallbackPayload),
        });

        const fallback = await r2.json();
        if (!fallback.ok)
          throw new Error(fallback.error ?? "Apps Script: erreur PDF facture");
        result = fallback;
      }

      const { error } = await supabase
        .from("invoices")
        .update({
          pdf_url: result.pdfUrl,
          pdf_file_id: result.pdfFileId,
          pdf_stale: false,
        })
        .eq("id", inv.id);

      if (error) throw error;

      await fetchLatestInvoices();
      if (result.pdfUrl) window.open(result.pdfUrl, "_blank");
    } catch (e: any) {
      alert("❌ " + (e?.message ?? "Erreur PDF facture"));
    } finally {
      setRowBusy(setLoadingInvRegen, inv.id, false);
    }
  }

  async function sendInvoiceFromGestion(inv: InvoiceRow) {
    setRowBusy(setLoadingInvSend, inv.id, true);

    try {
      const email = inv.clients?.email || "";
      if (!email) {
        alert("⚠️ Le client n’a pas d’email.");
        return;
      }

      const fresh = await ensureFreshInvoicePdf(inv);

      if (!fresh.pdf_file_id) {
        alert(
          "❌ Impossible d’envoyer : pdf_file_id manquant même après régénération.",
        );
        return;
      }

      const payload = {
        action: "send_invoice_email",
        payload: {
          toEmail: email,
          invoiceNumber: fresh.invoice_number,
          pdfFileId: fresh.pdf_file_id,
        },
      };

      const response = await fetch("/api/apps-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!result.ok) {
        alert("❌ Apps Script: " + (result.error ?? "Erreur inconnue"));
        return;
      }

      if (result.emailSent) {
        await updateInvoiceStatus(fresh.id, "envoye");
        alert("✅ Facture envoyée !");
      } else {
        alert(
          "⚠️ Email non envoyé: " + (result.emailError ?? "raison inconnue"),
        );
      }
    } catch (e: any) {
      alert("❌ " + (e?.message ?? "Erreur envoi facture"));
    } finally {
      setRowBusy(setLoadingInvSend, inv.id, false);
    }
  }

  async function ensureFreshQuotePdf(q: QuoteRow): Promise<QuoteRow> {
    const need =
      Boolean(q.pdf_stale) ||
      !q.pdf_file_id ||
      !q.pdf_url ||
      !q.doc_id ||
      !q.folder_id;

    if (!need) return q;

    await regeneratePdfFromGestion(q);

    const { data, error } = await supabase
      .from("quotes")
      .select(
        `
        id,
        quote_number,
        client_id,
        status,
        doc_url,
        pdf_url,
        doc_id,
        folder_id,
        pdf_file_id,
        total_amount,
        pdf_stale,
        created_at,
        labor_cost,
        clients:clients!quotes_client_id_fkey ( first_name, last_name, plate, email ),
        quote_items:quote_items!quote_items_quote_id_fkey ( id, description, unit_price, quantity )
      `,
      )
      .eq("id", q.id)
      .single();

    if (error) throw error;

    const row = data as any;

    const normalized: QuoteRow = {
      ...row,
      clients: one<ClientMini>(row.clients),
      quote_items: Array.isArray(row.quote_items) ? row.quote_items : [],
    };

    return normalized;
  }

  async function deleteInvoice(inv: InvoiceRow) {
    if (
      !confirm(
        `Supprimer la facture F-${String(inv.invoice_number).padStart(6, "0")} ?`,
      )
    )
      return;

    try {
      // 1) lignes
      const { error: itErr } = await supabase
        .from("invoice_items")
        .delete()
        .eq("invoice_id", inv.id);
      if (itErr) throw itErr;

      // 2) facture
      const { error: invErr } = await supabase
        .from("invoices")
        .delete()
        .eq("id", inv.id);
      if (invErr) throw invErr;

      await fetchLatestInvoices();
    } catch (e: any) {
      alert("❌ Erreur suppression facture : " + (e?.message ?? "Erreur"));
    }
  }

  async function deleteQuoteFull(q: QuoteRow) {
    if (
      !confirm(
        `Supprimer le devis D-${String(q.quote_number).padStart(6, "0")} ?`,
      )
    )
      return;

    try {
      // 1) lignes
      const { error: itErr } = await supabase
        .from("quote_items")
        .delete()
        .eq("quote_id", q.id);
      if (itErr) throw itErr;

      // 2) devis
      const { error: qErr } = await supabase
        .from("quotes")
        .delete()
        .eq("id", q.id);
      if (qErr) throw qErr;

      await fetchLatestQuotes();
    } catch (e: any) {
      alert("❌ Erreur suppression devis : " + (e?.message ?? "Erreur"));
    }
  }

  async function deleteClient(c: ClientRow) {
    const fullName =
      `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Client";
    if (
      !confirm(
        `Supprimer ${fullName} (${c.plate ?? "sans plaque"}) ?\n⚠️ À faire seulement si ses devis/factures sont supprimés.`,
      )
    )
      return;

    try {
      const { error } = await supabase.from("clients").delete().eq("id", c.id);
      if (error) throw error;

      await fetchLatestClients();
    } catch (e: any) {
      alert(
        "❌ Suppression client impossible (probablement lié à des devis/factures/réparations).\n" +
          (e?.message ?? "Erreur"),
      );
    }
  }

  const fetchLatestClients = useCallback(async () => {
    setClientsLoading(true);
    setClientsError(null);

    try {
      const { data, error } = await supabase
        .from("clients")
        .select(
          `
          id,
          created_at,
          first_name,
          last_name,
          email,
          phone,
          plate,
          vehicle_type,
          address
        `,
        )
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      setClients((data ?? []) as ClientRow[]);
    } catch (e: any) {
      console.error("fetchLatestClients failed:", extractErr(e));
      setClients([]);
      setClientsError(`❌ ${e?.message ?? "Erreur chargement clients"}`);
    } finally {
      setClientsLoading(false);
    }
  }, []);

  const fetchLatestQuotes = useCallback(async () => {
    setQuotesLoading(true);
    setQuotesError(null);

    try {
      const { data, error } = await supabase
        .from("quotes")
        .select(
          `
  id,
  quote_number,
  client_id,
  status,
  doc_url,
  pdf_url,
  doc_id,
  folder_id,
  pdf_file_id,
  total_amount,
  pdf_stale,
  created_at,
  labor_cost,

  clients:clients!quotes_client_id_fkey ( first_name, last_name, plate, email ),
  quote_items:quote_items!quote_items_quote_id_fkey ( id, description, unit_price, quantity )
`,
        )
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      const rows = (data ?? []) as any[];

      const normalized: QuoteRow[] = rows.map((r) => ({
        ...r,
        clients: one<ClientMini>(r.clients),
        quote_items: Array.isArray(r.quote_items) ? r.quote_items : [],
      }));

      setQuotes(normalized);
    } catch (e: any) {
      console.error("fetchLatestQuotes failed:", extractErr(e));
      setQuotes([]);
      setQuotesError(`❌ ${e?.message ?? "Erreur chargement devis"}`);
    } finally {
      setQuotesLoading(false);
    }
  }, []);
  // Charge clients onglet
  useEffect(() => {
    if (tab === "clients") fetchLatestClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Charge devis onglet
  useEffect(() => {
    if (tab === "devis") fetchLatestQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab !== "factures") return;
    fetchLatestInvoices(selectedYear, selectedMonth);
  }, [tab, selectedMonth, selectedYear, fetchLatestInvoices]);

  const filteredLatestClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients;

    return clients.filter((c) => {
      const full = [
        c.first_name ?? "",
        c.last_name ?? "",
        c.email ?? "",
        c.phone ?? "",
        c.plate ?? "",
        c.vehicle_type ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return full.includes(q);
    });
  }, [clientSearch, clients]);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header + Tabs */}
        <div className="p-5 rounded-3xl bg-white/5 border border-white/10">
          <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-2xl font-extrabold truncate">
                    📊 Portail Gestion
                  </div>
                </div>

                <a
                  href="/"
                  className="shrink-0 px-4 py-3 rounded-2xl font-extrabold bg-white/10 border border-white/10 hover:bg-white/15"
                >
                  ↩️ Accueil
                </a>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <TabButton
                  active={tab === "clients"}
                  onClick={() => setTab("clients")}
                >
                  👥 Clients
                </TabButton>
                <TabButton
                  active={tab === "devis"}
                  onClick={() => setTab("devis")}
                >
                  🧾 Devis
                </TabButton>
                <TabButton
                  active={tab === "factures"}
                  onClick={() => setTab("factures")}
                >
                  💳 Factures
                </TabButton>
                <TabButton
                  active={tab === "parametres"}
                  onClick={() => setTab("parametres")}
                >
                  ⚙️ Paramètres
                </TabButton>
              </div>
            </div>
          </div>
        </div>

        {/* CONTENT */}
        <div className="mt-5">
          {tab === "clients" && (
            <div className="p-5 rounded-3xl bg-white/5 border border-white/10">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div>
                  <div className="text-xl font-extrabold">👥 Clients</div>
                  <div className="text-white/60 text-sm">
                    Affiche les 10 derniers clients. Recherche complète ensuite.
                  </div>
                </div>

                <div className="w-full md:w-[380px]">
                  <div className="text-xs text-white/50 mb-1">
                    🔎 Filtre rapide
                  </div>
                  <input
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="Nom, plaque, tel, email…"
                    className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none placeholder:text-white/40"
                  />
                </div>
              </div>

              <div className="mt-4">
                {clientsLoading && (
                  <div className="text-white/70">⏳ Chargement…</div>
                )}
                {clientsError && (
                  <div className="p-3 rounded-2xl bg-red-500/20 border border-red-400/30 text-red-100">
                    {clientsError}
                  </div>
                )}

                {!clientsLoading &&
                  !clientsError &&
                  filteredLatestClients.length === 0 && (
                    <div className="p-4 rounded-2xl bg-black/30 border border-white/10 text-white/70">
                      Aucun client à afficher.
                    </div>
                  )}

                {!clientsLoading && filteredLatestClients.length > 0 && (
                  <div className="overflow-x-auto rounded-2xl border border-white/10 mt-4">
                    <table className="w-full text-sm table-fixed">
                      <thead className="bg-white/5 text-white/60 uppercase tracking-wider text-[11px]">
                        <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-extrabold">
                          <th className="text-left w-[26%]">Client</th>
                          <th className="text-left w-[16%]">Plaque</th>
                          <th className="text-left w-[18%]">Téléphone</th>
                          <th className="text-left w-[28%]">Email</th>
                          <th className="text-center w-[12%]">Actions</th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-white/10">
                        {clientsLoading && (
                          <tr>
                            <td className="px-4 py-4 text-white/70" colSpan={5}>
                              ⏳ Chargement…
                            </td>
                          </tr>
                        )}

                        {!clientsLoading && clientsError && (
                          <tr>
                            <td className="px-4 py-4 text-red-100" colSpan={5}>
                              ❌ {clientsError}
                            </td>
                          </tr>
                        )}

                        {!clientsLoading &&
                          !clientsError &&
                          filteredLatestClients.length === 0 && (
                            <tr>
                              <td
                                className="px-4 py-4 text-white/70"
                                colSpan={5}
                              >
                                Aucun client à afficher.
                              </td>
                            </tr>
                          )}

                        {!clientsLoading &&
                          !clientsError &&
                          filteredLatestClients.map((c) => {
                            const fullName =
                              `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() ||
                              "—";
                            return (
                              <tr
                                key={c.id}
                                className="bg-black/20 hover:bg-white/[0.06] transition-colors"
                              >
                                <td className="px-4 py-3 font-extrabold truncate">
                                  {fullName}
                                </td>
                                <td className="px-4 py-3">
                                  <PlateBadge plate={c.plate} />
                                </td>
                                <td className="px-4 py-3 text-white/80">
                                  {c.phone || "—"}
                                </td>
                                <td className="px-4 py-3 text-white/80 truncate">
                                  {c.email || "—"}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex justify-center gap-2">
                                    <button
                                      onClick={() => openEditClient(c)}
                                      className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 font-extrabold"
                                      type="button"
                                      title="Modifier"
                                    >
                                      ✏️
                                    </button>

                                    <button
                                      onClick={() => deleteClient(c)}
                                      className="px-3 py-2 rounded-xl bg-red-500 text-white hover:opacity-90 font-extrabold"
                                      type="button"
                                      title="Supprimer"
                                    >
                                      🗑
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={fetchLatestClients}
                    className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 hover:bg-white/15 font-bold"
                    type="button"
                  >
                    🔄 Rafraîchir
                  </button>

                  <div className="text-xs text-white/50 flex items-center">
                    Prochaine étape : vraie recherche (anciens clients) +
                    pagination.
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "devis" && (
            <div className="p-5 rounded-3xl bg-white/5 border border-white/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xl font-extrabold">🧾 Devis</div>
                </div>

                <button
                  onClick={fetchLatestQuotes}
                  className="px-4 py-3 rounded-2xl font-extrabold bg-white/10 border border-white/10 hover:bg-white/15"
                  type="button"
                >
                  🔄 Rafraîchir
                </button>
              </div>

              {quotesLoading && (
                <p className="text-white/70 mt-4">⏳ Chargement…</p>
              )}
              {quotesError && (
                <div className="mt-4 p-3 rounded-2xl bg-red-500/20 border border-red-400/30 text-red-100">
                  ❌ {quotesError}
                </div>
              )}

              {!quotesLoading && !quotesError && quotes.length === 0 && (
                <div className="mt-4 p-4 rounded-2xl bg-black/30 border border-white/10 text-white/70">
                  Aucun devis pour le moment.
                </div>
              )}

              {!quotesLoading && quotes.length > 0 && (
                <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
                  <table className="w-full text-sm">
                    <thead className="bg-white/5 text-white/70">
                      <tr>
                        <th className="text-left p-3 w-[140px]">Devis</th>
                        <th className="text-left p-3">Client</th>
                        <th className="text-left p-3 w-[170px]">Plaque</th>
                        <th className="text-right p-3 w-[140px]">Total</th>
                        <th className="text-left p-3 w-[180px]">Statut</th>
                        <th className="text-left p-3 w-[460px]">Actions</th>
                      </tr>
                    </thead>

                    <tbody>
                      {quotes.map((q) => {
                        const clientName = q.clients
                          ? `${q.clients.first_name ?? ""} ${q.clients.last_name ?? ""}`.trim()
                          : "—";

                        const fallbackParts = (q.quote_items ?? []).reduce(
                          (sum, it) => {
                            const up = Number(it.unit_price || 0);
                            const qt = Number(it.quantity || 0);
                            return sum + up * qt;
                          },
                          0,
                        );
                        const fallbackTotal =
                          fallbackParts + Number(q.labor_cost || 0);

                        const total = Number(
                          q.total_amount != null
                            ? q.total_amount
                            : fallbackTotal,
                        );

                        const isRegen = Boolean(loadingRegen[q.id]);
                        const isSend = Boolean(loadingSend[q.id]);
                        const isConvert = Boolean(loadingConvert[q.id]);
                        const isBusy = isRegen || isSend || isConvert;

                        const needsPdf =
                          Boolean(q.pdf_stale) || !q.pdf_file_id || !q.pdf_url;

                        return (
                          <tr
                            key={q.id}
                            className="border-t border-white/10 bg-black/20"
                          >
                            <td className="p-3 font-extrabold">
                              D-{String(q.quote_number).padStart(6, "0")}
                              {needsPdf && (
                                <div className="text-xs mt-1 text-amber-300 font-bold">
                                  ⚠️ PDF à régénérer
                                </div>
                              )}
                            </td>

                            <td className="p-3">
                              <div className="font-bold">
                                {clientName || "—"}
                              </div>
                              <div className="text-white/40 text-xs">
                                {q.created_at?.slice(0, 10)}
                              </div>
                            </td>

                            <td className="p-3">
                              <PlateBadge plate={q.clients?.plate} />
                            </td>

                            <td className="p-3 text-right font-extrabold">
                              {total.toFixed(2)} €
                            </td>

                            <td className="p-3">
                              <select
                                value={(q.status as any) || "brouillon"}
                                onChange={(e) =>
                                  updateQuoteStatus(
                                    q.id,
                                    e.target.value as QuoteStatus,
                                  )
                                }
                                className="w-full px-3 py-2 rounded-xl bg-black/5 border border-white/10 outline-none font-bold"
                                disabled={isBusy}
                              >
                                <option value="brouillon">📝 Brouillon</option>
                                <option value="a_envoyer">🟠 À envoyer</option>
                                <option value="envoye">
                                  ✉️ Envoyé (email)
                                </option>
                                <option value="remis">
                                  🤝 Remis (main propre)
                                </option>
                                <option value="accepte">✅ Accepté</option>
                                <option value="refuse">❌ Refusé</option>
                                <option value="annule">🚫 Annulé</option>
                              </select>
                              <div className="text-black/50 text-xs mt-1">
                                {statusLabel(q.status)}
                              </div>
                            </td>

                            <td className="p-3">
                              <div className="flex justify-end gap-2 flex-wrap">
                                <button
                                  disabled={!q.pdf_url || isBusy}
                                  onClick={() =>
                                    q.pdf_url &&
                                    window.open(q.pdf_url, "_blank")
                                  }
                                  className={cn(
                                    "px-3 py-2 rounded-xl font-bold",
                                    q.pdf_url && !isBusy
                                      ? "bg-emerald-400 text-slate-950 hover:opacity-90"
                                      : "bg-white/5 text-white/30 cursor-not-allowed",
                                  )}
                                  type="button"
                                >
                                  📄 PDF
                                </button>

                                <button
                                  disabled={isBusy}
                                  onClick={() => regeneratePdfFromGestion(q)}
                                  className={cn(
                                    "px-3 py-2 rounded-xl font-bold",
                                    isBusy
                                      ? "bg-white/5 text-white/30 cursor-not-allowed"
                                      : "bg-sky-400 text-slate-950 hover:opacity-90",
                                  )}
                                  type="button"
                                >
                                  {isRegen ? "⏳ Re-PDF…" : "🔁 Re-PDF"}
                                </button>

                                <button
                                  disabled={isBusy}
                                  onClick={() => openEditQuote(q)}
                                  className={cn(
                                    "px-3 py-2 rounded-xl border font-bold",
                                    isBusy
                                      ? "bg-white/5 border-white/10 text-white/30 cursor-not-allowed"
                                      : "bg-white/10 border-white/10 hover:bg-white/15",
                                  )}
                                  type="button"
                                >
                                  ✏️ Modifier
                                </button>

                                <button
                                  disabled={isBusy}
                                  onClick={() => sendQuoteFromGestion(q)}
                                  className={cn(
                                    "px-3 py-2 rounded-xl border font-bold",
                                    isBusy
                                      ? "bg-white/5 border-white/10 text-white/30 cursor-not-allowed"
                                      : "bg-white/10 border-white/10 hover:bg-white/15",
                                  )}
                                  type="button"
                                  title="Auto-regénère le PDF si besoin, puis envoie"
                                >
                                  {isSend
                                    ? "⏳ Envoi…"
                                    : needsPdf
                                      ? "📧 Envoyer (auto PDF)"
                                      : "📧 Envoyer"}
                                </button>

                                <button
                                  disabled={isBusy}
                                  onClick={() => convertQuoteToInvoice(q)}
                                  className={cn(
                                    "px-3 py-2 rounded-xl border font-bold",
                                    isBusy
                                      ? "bg-white/5 border-white/10 text-white/30 cursor-not-allowed"
                                      : "bg-white/10 border-white/10 hover:bg-white/15",
                                  )}
                                  type="button"
                                >
                                  {isConvert ? "⏳ Facture…" : "🧾 Facture"}
                                </button>

                                <button
                                  disabled={isBusy}
                                  onClick={() => deleteQuoteFull(q)}
                                  className={cn(
                                    "px-3 py-2 rounded-xl font-bold",
                                    isBusy
                                      ? "bg-white/5 text-white/30 cursor-not-allowed"
                                      : "bg-red-500 text-white hover:opacity-90",
                                  )}
                                  type="button"
                                >
                                  🗑
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === "factures" && (
            <div className="p-5 rounded-3xl bg-white/5 border border-white/10 space-y-5">
              {/* Header */}
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div>
                  <div className="text-xl font-extrabold">💳 Factures</div>
                </div>

                <div className="flex flex-wrap gap-2 items-center">
                  {/* Mois */}
                  <div className="px-3 py-2 rounded-2xl bg-white/10 border border-white/10 font-bold">
                    <select
                      className="bg-transparent outline-none"
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(Number(e.target.value))}
                    >
                      {Array.from({ length: 12 }).map((_, i) => (
                        <option key={i} value={i}>
                          {monthLabel(i)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Année */}
                  <div className="px-3 py-2 rounded-2xl bg-white/10 border border-white/10 font-bold">
                    <input
                      type="number"
                      className="w-[90px] bg-transparent outline-none text-center"
                      value={selectedYear}
                      onChange={(e) =>
                        setSelectedYear(
                          Number(e.target.value) || new Date().getFullYear(),
                        )
                      }
                    />
                  </div>

                  <button
                    onClick={() => setOnlyUnpaid(false)}
                    className={cn(
                      "px-4 py-2 rounded-2xl font-extrabold border",
                      !onlyUnpaid
                        ? "bg-emerald-400 text-slate-950 border-emerald-300"
                        : "bg-white/10 border-white/10 hover:bg-white/15",
                    )}
                    type="button"
                  >
                    🔄 Tout
                  </button>

                  <button
                    onClick={() => setOnlyUnpaid(true)}
                    className={cn(
                      "px-4 py-2 rounded-2xl font-extrabold border",
                      onlyUnpaid
                        ? "bg-emerald-400 text-slate-950 border-emerald-300"
                        : "bg-white/10 border-white/10 hover:bg-white/15",
                    )}
                    type="button"
                  >
                    Non payées
                  </button>

                  <button
                    onClick={() => fetchLatestInvoices()}
                    className="px-4 py-2 rounded-2xl bg-white/10 hover:bg-white/15 font-extrabold border border-white/10"
                    type="button"
                  >
                    🔄 Rafraîchir
                  </button>
                </div>
              </div>

              {/* KPI */}
              <div className="flex gap-6 mt-6">
                <div className="flex-1 p-5 rounded-2xl bg-emerald-400 text-slate-950 shadow-xl">
                  <div className="text-sm font-semibold opacity-80">
                    💰 CA du mois (payées)
                  </div>
                  <div className="text-3xl font-extrabold mt-2">
                    {invoiceKpis.ca_month.toFixed(2)} €
                  </div>
                </div>

                <div className="flex-1 p-5 rounded-2xl bg-white/5 border border-white/10 shadow-lg">
                  <div className="text-sm font-semibold text-white/70">
                    🧾 CA mois dernier
                  </div>
                  <div className="text-3xl font-extrabold mt-2">
                    {invoiceKpis.ca_previous_month.toFixed(2)} €
                  </div>
                </div>

                <div className="flex-1 p-5 rounded-2xl bg-white/5 border border-white/10 shadow-lg">
                  <div className="text-sm font-semibold text-white/70">
                    📆 CA année (payées)
                  </div>
                  <div className="text-3xl font-extrabold mt-2">
                    {invoiceKpis.ca_year.toFixed(2)} €
                  </div>
                </div>

                <div className="flex-1 p-5 rounded-2xl bg-white/5 border border-white/10 shadow-lg">
                  <div className="text-sm font-semibold text-white/70">
                    📄 Factures affichées
                  </div>
                  <div className="text-3xl font-extrabold mt-2">
                    {filteredInvoices.length}
                  </div>
                </div>
              </div>

              <div className="flex gap-6 mt-6 mb-8"></div>

              {/* Recherche */}
              <input
                value={invoiceSearch}
                onChange={(e) => setInvoiceSearch(e.target.value)}
                placeholder="🔎 Recherche (num, statut, montant...)"
                className="w-full px-4 py-4 rounded-2xl bg-white/5 border border-white/10 outline-none mb-8"
              />

              <div className="overflow-x-auto rounded-2xl border border-white/10 mt-2"></div>

              {/* Table */}
              <div className="overflow-x-auto rounded-2xl border border-white/10">
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    <col className="w-[18%]" />
                    <col className="w-[15%]" />
                    <col className="w-[27%]" />
                    <col className="w-[10%]" />
                    <col className="w-[30%]" />
                  </colgroup>

                  <thead className="bg-white/5 text-white/70">
                    <tr className="text-sm font-bold">
                      <th className="px-4 py-3 text-left">Facture</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-4 py-3 text-left">Statut</th>
                      <th className="px-4 py-3 text-center">Payé</th>
                      <th className="px-4 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoicesLoading && (
                      <tr>
                        <td className="p-4 text-white/70" colSpan={5}>
                          ⏳ Chargement…
                        </td>
                      </tr>
                    )}

                    {!invoicesLoading && filteredInvoices.length === 0 && (
                      <tr>
                        <td className="p-4 text-white/70" colSpan={5}>
                          Aucune facture à afficher.
                        </td>
                      </tr>
                    )}

                    {!invoicesLoading &&
                      filteredInvoices.map((inv) => (
                        <tr
                          key={inv.id}
                          className="border-t border-white/10 bg-black/20"
                        >
                          <td className="p-3 font-bold">
                            F-{String(inv.invoice_number).padStart(6, "0")}
                          </td>

                          <td className="p-3 text-right font-extrabold">
                            {Number(inv.total_amount || 0).toFixed(2)} €
                          </td>

                          <td className="p-3">
                            <select
                              value={(inv.status as any) || "brouillon"}
                              onChange={(e) =>
                                updateInvoiceStatus(
                                  inv.id,
                                  e.target.value as InvoiceStatus,
                                )
                              }
                              className="w-full px-3 py-2 rounded-xl bg-black/5 border border-white/10 outline-none font-bold"
                            >
                              <option value="brouillon">📝 Brouillon</option>
                              <option value="a_envoyer">🟠 À envoyer</option>
                              <option value="envoye">✉️ Envoyée</option>
                              <option value="payee">✅ Payée</option>
                              <option value="annule">🚫 Annulée</option>
                            </select>
                          </td>

                          <td className="px-4 py-3 text-center">
                            <div className="flex justify-center">
                              <input
                                type="checkbox"
                                checked={Boolean(inv.paid)}
                                onChange={(e) =>
                                  toggleInvoicePaid(inv, e.target.checked)
                                }
                                className="h-5 w-5 accent-emerald-400"
                              />
                            </div>
                          </td>

                          <td className="px-4 py-3 text-center">
                            <div className="flex justify-center gap-2">
                              <button
                                onClick={() => openEditInvoice(inv)}
                                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 font-bold"
                                type="button"
                              >
                                ✏️
                              </button>

                              <button
                                onClick={() =>
                                  regenerateInvoicePdfFromGestion(inv)
                                }
                                className="px-3 py-2 rounded-xl bg-sky-400 text-slate-950 hover:opacity-90 font-bold"
                                type="button"
                                disabled={Boolean(loadingInvRegen[inv.id])}
                              >
                                {loadingInvRegen[inv.id] ? "⏳ PDF…" : "🔁 PDF"}
                              </button>

                              <button
                                onClick={() => sendInvoiceFromGestion(inv)}
                                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 font-bold"
                                type="button"
                                disabled={Boolean(loadingInvSend[inv.id])}
                                title="Auto-regénère le PDF si besoin, puis envoie"
                              >
                                {loadingInvSend[inv.id] ? "⏳ Mail…" : "📧"}
                              </button>

                              {inv.pdf_url ? (
                                <button
                                  onClick={() => {
                                    const url = inv.pdf_url;
                                    if (url) window.open(url, "_blank");
                                  }}
                                  className="px-3 py-2 rounded-xl bg-emerald-400 text-slate-950 hover:opacity-90 font-bold"
                                  type="button"
                                >
                                  📄
                                </button>
                              ) : (
                                <span className="text-white/40 px-2 py-2">
                                  —
                                </span>
                              )}
                              <button
                                onClick={() => deleteInvoice(inv)}
                                className="px-3 py-2 rounded-xl bg-red-500 text-white hover:opacity-90 font-bold"
                                type="button"
                                title="Supprimer"
                              >
                                🗑
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "parametres" && <ParametresSection />}
        </div>

        {/* MODAL EDIT CLIENT */}
        {editOpen && editingClient && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="w-full max-w-xl rounded-3xl bg-slate-900 border border-white/10 shadow-2xl">
              <div className="p-5 border-b border-white/10 flex items-center justify-between">
                <div>
                  <div className="text-xl font-extrabold">✏️ Éditer client</div>
                  <div className="text-white/50 text-xs">
                    ID : {editingClient.id}
                  </div>
                </div>
                <button
                  onClick={closeEditClient}
                  className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15"
                  type="button"
                >
                  ✖️
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none"
                    placeholder="Prénom"
                    value={editDraft.first_name}
                    onChange={(e) =>
                      setEditDraft((p) => ({
                        ...p,
                        first_name: e.target.value,
                      }))
                    }
                  />
                  <input
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none"
                    placeholder="Nom"
                    value={editDraft.last_name}
                    onChange={(e) =>
                      setEditDraft((p) => ({ ...p, last_name: e.target.value }))
                    }
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none"
                    placeholder="Téléphone"
                    value={editDraft.phone}
                    onChange={(e) =>
                      setEditDraft((p) => ({ ...p, phone: e.target.value }))
                    }
                  />
                  <input
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none"
                    placeholder="Email"
                    value={editDraft.email}
                    onChange={(e) =>
                      setEditDraft((p) => ({ ...p, email: e.target.value }))
                    }
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none font-mono"
                    placeholder="Plaque"
                    value={editDraft.plate}
                    onChange={(e) =>
                      setEditDraft((p) => ({ ...p, plate: e.target.value }))
                    }
                  />
                  <input
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none"
                    placeholder="Véhicule"
                    value={editDraft.vehicle_type}
                    onChange={(e) =>
                      setEditDraft((p) => ({
                        ...p,
                        vehicle_type: e.target.value,
                      }))
                    }
                  />
                </div>

                <textarea
                  className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none min-h-[90px]"
                  placeholder="Adresse"
                  value={editDraft.address}
                  onChange={(e) =>
                    setEditDraft((p) => ({ ...p, address: e.target.value }))
                  }
                />

                {editMsg && (
                  <div className="text-sm text-white/80">{editMsg}</div>
                )}

                <div className="flex items-center justify-between gap-3 pt-2">
                  <button
                    onClick={closeEditClient}
                    className="px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/15"
                    type="button"
                    disabled={editSaving}
                  >
                    ↩️ Annuler
                  </button>

                  <button
                    onClick={saveClientEdit}
                    className={cn(
                      "px-5 py-3 rounded-2xl font-extrabold shadow-lg",
                      editSaving
                        ? "bg-white/10 text-white/40 cursor-not-allowed"
                        : "bg-emerald-400 text-slate-950 hover:opacity-90",
                    )}
                    type="button"
                    disabled={editSaving}
                  >
                    {editSaving ? "⏳ Sauvegarde…" : "✅ Enregistrer"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MODAL EDIT DEVIS */}
        {quoteEditOpen && quoteEditing && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="w-full max-w-3xl rounded-3xl bg-slate-900 border border-white/10 shadow-2xl">
              <div className="p-5 border-b border-white/10 flex items-center justify-between">
                <div>
                  <div className="text-xl font-extrabold">
                    ✏️ Modifier devis D-
                    {String(quoteEditing.quote_number).padStart(6, "0")}
                  </div>
                  <div className="text-white/60 text-sm">
                    {quoteEditing.clients?.first_name}{" "}
                    {quoteEditing.clients?.last_name} •{" "}
                    {quoteEditing.clients?.plate}
                  </div>
                </div>
                <button
                  onClick={closeEditQuote}
                  className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15"
                  type="button"
                  disabled={quoteEditSaving}
                >
                  ✖️
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                    <div className="text-sm font-bold text-white/70">
                      Main d’œuvre (€)
                    </div>
                    <input
                      type="number"
                      className="mt-2 w-full px-4 py-3 rounded-2xl bg-black/30 border border-white/10 text-right font-extrabold"
                      value={quoteEditLabor}
                      onChange={(e) =>
                        setQuoteEditLabor(Number(e.target.value))
                      }
                    />
                  </div>

                  <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                    <div className="flex justify-between text-sm text-white/70">
                      <span>Total pièces</span>
                      <span className="font-bold">
                        {editPartsTotal.toFixed(2)} €
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-white/70 mt-1">
                      <span>Main d’œuvre</span>
                      <span className="font-bold">
                        {Number(quoteEditLabor || 0).toFixed(2)} €
                      </span>
                    </div>
                    <div className="flex justify-between text-base mt-2">
                      <span className="font-extrabold">TOTAL</span>
                      <span className="font-extrabold">
                        {editTotal.toFixed(2)} €
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-black/30 border border-white/10">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-extrabold">Pièces</div>
                    <button
                      onClick={addEditQuoteItem}
                      className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 hover:bg-white/15 font-bold"
                      type="button"
                    >
                      ➕ Ajouter
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-12 gap-2 text-xs text-white/60 px-1">
                    <div className="col-span-6">Désignation</div>
                    <div className="col-span-2 text-right">Qté</div>
                    <div className="col-span-3 text-right">€ unitaire</div>
                    <div className="col-span-1 text-right"> </div>
                  </div>

                  <div className="mt-2 space-y-2">
                    {quoteEditItems.map((item, index) => (
                      <div key={index} className="grid grid-cols-12 gap-2">
                        <input
                          className="col-span-6 px-3 py-2 rounded-xl bg-white/5 border border-white/10"
                          placeholder="Désignation (ex: Plaquettes)"
                          value={item.description}
                          onChange={(e) =>
                            updateEditQuoteItem(
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
                            updateEditQuoteItem(
                              index,
                              "quantity",
                              e.target.value,
                            )
                          }
                        />
                        <input
                          type="number"
                          className="col-span-3 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-right"
                          value={item.unit_price}
                          onChange={(e) =>
                            updateEditQuoteItem(
                              index,
                              "unit_price",
                              e.target.value,
                            )
                          }
                        />
                        <button
                          onClick={() => removeEditQuoteItem(index)}
                          className="col-span-1 px-2 py-2 rounded-xl bg-red-500/80 text-white font-bold hover:opacity-90"
                          type="button"
                          title="Supprimer la ligne"
                        >
                          ✖
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {quoteEditMsg && (
                  <div className="text-sm text-white/80">{quoteEditMsg}</div>
                )}

                <div className="flex items-center justify-between gap-3 pt-2">
                  <button
                    onClick={closeEditQuote}
                    className="px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/15"
                    type="button"
                    disabled={quoteEditSaving}
                  >
                    ↩️ Annuler
                  </button>

                  <button
                    onClick={saveQuoteEdit}
                    className={cn(
                      "px-5 py-3 rounded-2xl font-extrabold shadow-lg",
                      quoteEditSaving
                        ? "bg-white/10 text-white/40 cursor-not-allowed"
                        : "bg-emerald-400 text-slate-950 hover:opacity-90",
                    )}
                    type="button"
                    disabled={quoteEditSaving}
                  >
                    {quoteEditSaving ? "⏳ Sauvegarde…" : "✅ Enregistrer"}
                  </button>
                </div>

                <div className="text-xs text-white/50">
                  💡 Après sauvegarde : total mis à jour + pdf_stale = true
                  (donc envoi auto-PDF) ✅
                </div>
              </div>
            </div>
          </div>
        )}
        {/* MODAL EDIT FACTURE */}
        {invoiceEditOpen && invoiceEditing && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="w-full max-w-3xl rounded-3xl bg-slate-900 border border-white/10 shadow-2xl">
              <div className="p-5 border-b border-white/10 flex items-center justify-between">
                <div>
                  <div className="text-xl font-extrabold">
                    ✏️ Modifier facture F-
                    {String(invoiceEditing.invoice_number).padStart(6, "0")}
                  </div>
                  <div className="text-white/60 text-sm">
                    {invoiceEditing.clients?.first_name}{" "}
                    {invoiceEditing.clients?.last_name} •{" "}
                    {invoiceEditing.clients?.plate}
                  </div>
                </div>

                <button
                  onClick={closeEditInvoice}
                  className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15"
                  type="button"
                  disabled={invoiceEditSaving}
                >
                  ✖️
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                    <div className="text-sm font-bold text-white/70">
                      Main d’œuvre (€)
                    </div>
                    <input
                      type="number"
                      className="mt-2 w-full px-4 py-3 rounded-2xl bg-black/30 border border-white/10 text-right font-extrabold"
                      value={invoiceEditLabor}
                      onChange={(e) =>
                        setInvoiceEditLabor(Number(e.target.value))
                      }
                    />
                  </div>

                  <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                    <div className="flex justify-between text-sm text-white/70">
                      <span>Total pièces</span>
                      <span className="font-bold">
                        {invoiceEditPartsTotal.toFixed(2)} €
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-white/70 mt-1">
                      <span>Main d’œuvre</span>
                      <span className="font-bold">
                        {Number(invoiceEditLabor || 0).toFixed(2)} €
                      </span>
                    </div>
                    <div className="flex justify-between text-base mt-2">
                      <span className="font-extrabold">TOTAL</span>
                      <span className="font-extrabold">
                        {invoiceEditTotal.toFixed(2)} €
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-black/30 border border-white/10">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-extrabold">Pièces</div>
                    <button
                      onClick={addEditInvoiceItem}
                      className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 hover:bg-white/15 font-bold"
                      type="button"
                    >
                      ➕ Ajouter
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-12 gap-2 text-xs text-white/60 px-1">
                    <div className="col-span-6">Désignation</div>
                    <div className="col-span-2 text-right">Qté</div>
                    <div className="col-span-3 text-right">€ unitaire</div>
                    <div className="col-span-1 text-right"> </div>
                  </div>

                  <div className="mt-2 space-y-2">
                    {invoiceEditItems.map((item, index) => (
                      <div key={index} className="grid grid-cols-12 gap-2">
                        <input
                          className="col-span-6 px-3 py-2 rounded-xl bg-white/5 border border-white/10"
                          placeholder="Désignation (ex: Plaquettes)"
                          value={item.description}
                          onChange={(e) =>
                            updateEditInvoiceItem(
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
                            updateEditInvoiceItem(
                              index,
                              "quantity",
                              e.target.value,
                            )
                          }
                        />
                        <input
                          type="number"
                          className="col-span-3 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-right"
                          value={item.unit_price}
                          onChange={(e) =>
                            updateEditInvoiceItem(
                              index,
                              "unit_price",
                              e.target.value,
                            )
                          }
                        />
                        <button
                          onClick={() => removeEditInvoiceItem(index)}
                          className="col-span-1 px-2 py-2 rounded-xl bg-red-500/80 text-white font-bold hover:opacity-90"
                          type="button"
                          title="Supprimer la ligne"
                        >
                          ✖
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {invoiceEditMsg && (
                  <div className="text-sm text-white/80">{invoiceEditMsg}</div>
                )}

                <div className="flex items-center justify-between gap-3 pt-2">
                  <button
                    onClick={closeEditInvoice}
                    className="px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/15"
                    type="button"
                    disabled={invoiceEditSaving}
                  >
                    ↩️ Annuler
                  </button>

                  <button
                    onClick={saveInvoiceEdits}
                    className={cn(
                      "px-5 py-3 rounded-2xl font-extrabold shadow-lg",
                      invoiceEditSaving
                        ? "bg-white/10 text-white/40 cursor-not-allowed"
                        : "bg-emerald-400 text-slate-950 hover:opacity-90",
                    )}
                    type="button"
                    disabled={invoiceEditSaving}
                  >
                    {invoiceEditSaving ? "⏳ Sauvegarde…" : "✅ Enregistrer"}
                  </button>
                </div>

                <div className="text-xs text-white/50">
                  💡 Après sauvegarde : total mis à jour + pdf_stale = true ✅
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
