import { NextResponse } from "next/server";

export const runtime = "nodejs"; // ✅ force Node runtime (évite Edge surprises)

// URL Apps Script (ok en dur pour l’instant)
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbweKy4ldF8p3j86I3PiDuLLFTYy3ws8u46Cb2f69fvg4Q7bmH0ljQ0-LC81EjixhRCh/exec";

function json(obj: any, status = 200) {
  return NextResponse.json(obj, { status });
}

// Helper: renvoie JSON si possible, sinon texte
async function readJsonOrText(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  const raw = await res.text();

  if (contentType.includes("application/json")) {
    try {
      return { isJson: true, data: JSON.parse(raw), raw };
    } catch {
      return { isJson: false, data: null as any, raw };
    }
  }

  return { isJson: false, data: null as any, raw };
}

export async function POST(req: Request) {
  let body: any = null;

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body JSON invalide" }, 200);
  }

  // ✅ timeout pour éviter les requêtes pendues
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    let upstream: Response;

    try {
      upstream = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        redirect: "follow",
        signal: controller.signal,
      });
    } catch (e: any) {
      const msg =
        e?.name === "AbortError"
          ? "Timeout (45s) vers Apps Script"
          : e?.message || "Erreur réseau fetch() vers Apps Script";

      return json(
        {
          ok: false,
          error: msg,
          hint: "Si c’est un timeout : la régénération PDF est trop lente ou Apps Script ne répond pas. Si c’est réseau : problème URL/deploy/permissions.",
        },
        200,
      );
    } finally {
      clearTimeout(timeout);
    }

    const parsed = await readJsonOrText(upstream);

    // ✅ Si Apps Script renvoie du JSON, on le renvoie tel quel
    if (parsed.isJson && parsed.data) {
      return json(parsed.data, 200);
    }

    // ✅ sinon on renvoie un JSON lisible avec preview
    return json(
      {
        ok: false,
        error: "Réponse non-JSON depuis Apps Script",
        status: upstream.status,
        preview: (parsed.raw || "").slice(0, 500),
      },
      200,
    );
  } catch (e: any) {
    // Catch ultime (pour éviter que Next coupe la connexion)
    return json(
      {
        ok: false,
        error: e?.message ?? "Erreur inconnue (route /api/apps-script)",
      },
      200,
    );
  }
}

export async function GET() {
  return json({ ok: false, error: "Use POST on this endpoint." }, 200);
}
