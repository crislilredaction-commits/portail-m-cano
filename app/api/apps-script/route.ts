import { NextResponse } from "next/server";

// URL Apps Script (idéalement via env, mais ok en dur pour l’instant)
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbweKy4ldF8p3j86I3PiDuLLFTYy3ws8u46Cb2f69fvg4Q7bmH0ljQ0-LC81EjixhRCh/exec";

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
  try {
    const body = await req.json();

    const upstream = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const parsed = await readJsonOrText(upstream);

    if (parsed.isJson && parsed.data) {
      return NextResponse.json(parsed.data, { status: 200 });
    }

    return NextResponse.json(
      {
        ok: false,
        error: "Réponse non-JSON depuis Apps Script",
        status: upstream.status,
        preview: (parsed.raw || "").slice(0, 300),
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message ?? "Erreur inconnue (route /api/apps-script)",
      },
      { status: 200 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Use POST on this endpoint." },
    { status: 200 },
  );
}
