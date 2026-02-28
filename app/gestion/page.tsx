"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ReactNode } from "react";

type TabKey = "dashboard" | "clients" | "devis" | "factures" | "parametres";

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

  // ✅ important : le bon champ d'après toi
  total_amount: number | null;

  // ✅ indicateur Supabase : PDF plus à jour
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

export default function GestionPage() {
  const [tab, setTab] = useState<TabKey>("dashboard");

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

  // états visuels par devis (anti double-clic)
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

  const [invoices, setInvoices] = useState<any[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth()); // 0-11

  const filteredInvoices = useMemo(() => {
    const q = invoiceSearch.toLowerCase();

    return invoices.filter((inv) => {
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
  }, [invoiceSearch, invoices]);

  const caMonth = filteredInvoices
    .filter((i) => i.paid)
    .reduce((sum, i) => sum + Number(i.total_amount || 0), 0);

  const caYear = invoices
    .filter(
      (i) => i.paid && new Date(i.created_at).getFullYear() === selectedYear,
    )
    .reduce((sum, i) => sum + Number(i.total_amount || 0), 0);

  const previousMonthDate = new Date(selectedYear, selectedMonth - 1, 1);

  const caPreviousMonth = invoices
    .filter((i) => {
      if (!i.paid) return false;
      const d = new Date(i.created_at);
      return (
        d.getFullYear() === previousMonthDate.getFullYear() &&
        d.getMonth() === previousMonthDate.getMonth()
      );
    })
    .reduce((sum, i) => sum + Number(i.total_amount || 0), 0);

  function setRowBusy(
    setter: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
    id: string,
    value: boolean,
  ) {
    setter((prev) => ({ ...prev, [id]: value }));
  }

  async function fetchLatestClients() {
    setClientsLoading(true);
    setClientsError(null);
    try {
      const { data, error } = await supabase
        .from("clients")
        .select(
          "id, created_at, first_name, last_name, email, phone, plate, vehicle_type, address",
        )
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;
      setClients((data ?? []) as ClientRow[]);
    } catch (e: any) {
      setClientsError(e?.message ?? "Erreur chargement clients");
      setClients([]);
    } finally {
      setClientsLoading(false);
    }
  }

  async function fetchLatestQuotes() {
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
          clients ( first_name, last_name, plate, email ),
          quote_items ( id, description, unit_price, quantity )
        `,
        )
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;

      setQuotes((data ?? []) as any);
    } catch (e: any) {
      setQuotesError(e?.message ?? "Erreur chargement devis");
      setQuotes([]);
    } finally {
      setQuotesLoading(false);
    }
  }

  async function fetchLatestInvoices() {
    setInvoicesLoading(true);

    const startOfMonth = new Date(selectedYear, selectedMonth, 1);
    const endOfMonth = new Date(selectedYear, selectedMonth + 1, 1);

    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .gte("created_at", startOfMonth.toISOString())
      .lt("created_at", endOfMonth.toISOString())
      .order("created_at", { ascending: false });

    if (!error) setInvoices(data ?? []);
    setInvoicesLoading(false);
  }

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

  // ✅ sauvegarde édition devis => update quote_items + labor + total_amount + pdf_stale + refresh
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
          // on garde le statut actuel (géré par le select dans le tableau)
          status: (quoteEditing.status || "brouillon") as any,
          // ✅ important : le PDF n’est plus fiable après édition
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

  // ✅ Re-PDF "intelligent" : tente réécriture doc + pdf, fallback vers simple pdf
  async function regeneratePdfFromGestion(q: QuoteRow) {
    setRowBusy(setLoadingRegen, q.id, true);

    try {
      if (!q.doc_id || !q.folder_id) {
        alert("❌ doc_id ou folder_id manquant");
        return;
      }

      // data DB => payload pour réécrire le doc
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

      // 1) on tente la version "réécriture doc + pdf"
      let result: any = null;
      {
        const response = await fetch("/api/apps-script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rewritePayload),
        });
        result = await response.json();
      }

      // 2) fallback si l’action n’existe pas encore côté Apps Script
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

      // update DB
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

  // ✅ garantit un PDF à jour (auto régénération si stale ou pdf absent)
  async function ensureFreshPdf(q: QuoteRow): Promise<QuoteRow> {
    const need =
      Boolean(q.pdf_stale) ||
      !q.pdf_file_id ||
      !q.pdf_url ||
      !q.doc_id ||
      !q.folder_id;

    if (!need) return q;

    await regeneratePdfFromGestion(q);

    // on relit la ligne depuis Supabase pour récupérer pdf_file_id/ url à jour
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
        clients ( first_name, last_name, plate, email ),
        quote_items ( id, description, unit_price, quantity )
      `,
      )
      .eq("id", q.id)
      .single();

    if (error) throw error;
    return data as any;
  }

  // ✅ ENVOI : auto-regénère si nécessaire, puis envoie
  async function sendQuoteFromGestion(q: QuoteRow) {
    setRowBusy(setLoadingSend, q.id, true);

    try {
      const email = q.clients?.email || "";
      if (!email) {
        alert("⚠️ Le client n’a pas d’email.");
        return;
      }

      // 🔥 auto régénération si nécessaire
      const fresh = await ensureFreshPdf(q);

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

  async function toggleInvoicePaid(inv: any, nextPaid: boolean) {
    try {
      if (!inv.doc_id || !inv.folder_id) {
        alert("❌ doc_id ou folder_id manquant sur la facture");
        return;
      }

      // 1️⃣ Update DB
      const nextStatus = nextPaid ? "payee" : "envoye";

      const { error: updateErr } = await supabase
        .from("invoices")
        .update({
          paid: nextPaid,
          status: nextStatus,
        })
        .eq("id", inv.id);

      if (updateErr) throw updateErr;

      // 2️⃣ Appel Apps Script pour régénérer PDF
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

      if (!result.ok) {
        throw new Error(result.error ?? "Erreur Apps Script");
      }

      // 3️⃣ Update liens PDF en base
      const { error: pdfErr } = await supabase
        .from("invoices")
        .update({
          pdf_url: result.pdfUrl,
          pdf_file_id: result.pdfFileId,
        })
        .eq("id", inv.id);

      if (pdfErr) throw pdfErr;

      // 4️⃣ Refresh tableau
      await fetchLatestInvoices(); // ⚠️ mets le nom exact de ta fonction
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

  // ✅ conversion devis -> facture (avec loading + client_id obligatoire)
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

      // 1) numéro facture
      const { data: numData, error: numErr } = await supabase.rpc(
        "generate_invoice_number",
      );
      if (numErr) throw numErr;

      const invoiceNumber = Number(numData);
      if (!Number.isFinite(invoiceNumber))
        throw new Error("Numéro facture invalide");

      // 2) totaux depuis DB
      const partsTotal = (q.quote_items ?? []).reduce((sum, it) => {
        const up = Number(it.unit_price || 0);
        const qt = Number(it.quantity || 0);
        return sum + up * qt;
      }, 0);
      const labor = Number(q.labor_cost || 0);
      const total = Number(q.total_amount ?? partsTotal + labor);

      // 3) créer invoice
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

      // 4) copier items
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

      // 5) Apps Script generate invoice (doc+pdf)
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

      // 6) update invoice
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
    if (tab === "factures") fetchLatestInvoices();
  }, [tab, selectedMonth, selectedYear]);

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
        <div className="p-4 rounded-3xl bg-white/5 border border-white/10">
          <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
            <div>
              <div className="text-2xl font-extrabold">📊 Portail Gestion</div>
              <div className="text-white/60 text-sm">
                Dashboard • Clients • Devis • Factures • Paramètres
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <TabButton
                active={tab === "dashboard"}
                onClick={() => setTab("dashboard")}
              >
                📈 Dashboard
              </TabButton>
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

        {/* CONTENT */}
        <div className="mt-5">
          {tab === "dashboard" && (
            <div className="p-5 rounded-3xl bg-white/5 border border-white/10">
              <div className="text-xl font-extrabold">📈 Dashboard</div>
              <div className="text-white/60 mt-1">
                Prochaine action : CA année / mois / mois dernier ✅
              </div>
            </div>
          )}

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
                  <div className="overflow-hidden rounded-2xl border border-white/10">
                    <table className="w-full text-sm">
                      <thead className="bg-white/5 text-white/70">
                        <tr>
                          <th className="text-left p-3">Nom</th>
                          <th className="text-left p-3">Plaque</th>
                          <th className="text-left p-3">Véhicule</th>
                          <th className="text-left p-3">Contact</th>
                          <th className="text-left p-3">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLatestClients.map((c) => {
                          const name =
                            `${safeStr(c.first_name)} ${safeStr(c.last_name)}`.trim() ||
                            "—";
                          return (
                            <tr
                              key={c.id}
                              className="border-t border-white/10 bg-black/20"
                            >
                              <td className="p-3 font-bold">{name}</td>
                              <td className="p-3">
                                <PlateBadge plate={c.plate} />
                              </td>
                              <td className="p-3">{c.vehicle_type ?? "—"}</td>
                              <td className="p-3 text-white/80">
                                <div>{c.phone ?? "—"}</div>
                                <div className="text-white/50 text-xs">
                                  {c.email ?? ""}
                                </div>
                              </td>
                              <td className="p-3 text-right">
                                <button
                                  onClick={() => openEditClient(c)}
                                  className="px-3 py-2 rounded-xl bg-emerald-400 text-slate-950 font-extrabold hover:opacity-90"
                                  type="button"
                                >
                                  ✏️ Éditer
                                </button>
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
                  <div className="text-white/60 text-sm">
                    Statut + édition + PDF auto + envoi + conversion facture ✅
                  </div>
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
                                  onClick={() => deleteQuote(q)}
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
            <div className="p-5 rounded-3xl bg-white/5 border border-white/10 space-y-6">
              {/* Header */}
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-xl font-extrabold">💳 Factures</div>
                  <div className="text-white/60 text-sm">
                    CA basé uniquement sur les factures payées.
                  </div>
                </div>
                <button
                  onClick={fetchLatestInvoices}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 font-bold"
                >
                  🔄 Rafraîchir
                </button>
              </div>

              {/* KPI */}
              <div className="grid md:grid-cols-4 gap-4">
                <div className="p-4 rounded-2xl bg-emerald-400 text-slate-950">
                  <div className="text-sm">CA du mois</div>
                  <div className="text-2xl font-extrabold">
                    {caMonth.toFixed(2)} €
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white/10 border border-white/10">
                  <div className="text-sm">CA mois dernier</div>
                  <div className="text-2xl font-extrabold">
                    {caPreviousMonth.toFixed(2)} €
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white/10 border border-white/10">
                  <div className="text-sm">CA année</div>
                  <div className="text-2xl font-extrabold">
                    {caYear.toFixed(2)} €
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white/10 border border-white/10">
                  <div className="text-sm">Factures affichées</div>
                  <div className="text-2xl font-extrabold">
                    {filteredInvoices.length}
                  </div>
                </div>
              </div>

              {/* Recherche */}
              <input
                value={invoiceSearch}
                onChange={(e) => setInvoiceSearch(e.target.value)}
                placeholder="🔎 Recherche..."
                className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 outline-none"
              />

              {/* Table */}
              <div className="overflow-x-auto rounded-2xl border border-white/10">
                <table className="w-full text-sm">
                  <thead className="bg-white/5 text-white/70">
                    <tr>
                      <th className="p-3 text-left">Facture</th>
                      <th className="p-3 text-right">Total</th>
                      <th className="p-3 text-left">Statut</th>
                      <th className="p-3 text-left">Payé</th>
                      <th className="p-3 text-left">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInvoices.map((inv) => (
                      <tr key={inv.id} className="border-t border-white/10">
                        <td className="p-3 font-bold">
                          F-{String(inv.invoice_number).padStart(6, "0")}
                        </td>

                        <td className="p-3 text-right font-extrabold">
                          {Number(inv.total_amount || 0).toFixed(2)} €
                        </td>

                        <td className="p-3">{inv.status}</td>

                        <td className="p-3">
                          <input
                            type="checkbox"
                            checked={Boolean(inv.paid)}
                            onChange={(e) =>
                              toggleInvoicePaid(inv, e.target.checked)
                            }
                            className="h-5 w-5 accent-emerald-400"
                          />
                        </td>

                        <td className="p-3">
                          {inv.pdf_url && (
                            <button
                              onClick={() => window.open(inv.pdf_url, "_blank")}
                              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 font-bold"
                            >
                              📄 PDF
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "parametres" && (
            <div className="p-5 rounded-3xl bg-white/5 border border-white/10">
              <div className="text-xl font-extrabold">⚙️ Paramètres</div>
              <div className="text-white/60 mt-1">
                Prochaine action : régler “reprendre numéros devis/factures à
                partir de …”
              </div>
            </div>
          )}
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
      </div>
    </div>
  );
}
