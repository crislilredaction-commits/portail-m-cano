import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Autoriser login + fichiers Next
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api")
  ) {
    return NextResponse.next();
  }

  // Supabase Auth côté client stocke une session dans localStorage,
  // donc middleware ne peut pas la lire directement.
  // => On utilise une stratégie simple V1 :
  // on laisse passer, et l'app côté client redirige si pas de session.
  // (La vraie protection middleware nécessite supabase SSR + cookies.)
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
