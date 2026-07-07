import { NextRequest, NextResponse } from "next/server";

// Light access gate for "invited users": HTTP Basic Auth on the dashboard.
// Any username works; the password is DASHBOARD_PASSCODE. If that env var is
// unset the app stays open (so a fresh deploy still works, and local dev is easy).
//
// /api/evaluate is deliberately left open so the cron can trigger it. Auth depth
// (real per-user login) is a documented cut in SPEC.md / the write-up.
export const config = {
  matcher: ["/((?!api/evaluate|_next/static|_next/image|favicon.ico).*)"],
};

export function middleware(req: NextRequest) {
  const passcode = process.env.DASHBOARD_PASSCODE;
  if (!passcode) return NextResponse.next();

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6)); // "user:pass"
      const password = decoded.slice(decoded.indexOf(":") + 1);
      if (password === passcode) return NextResponse.next();
    } catch {
      // fall through to challenge
    }
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="DynaMo — CoolSip"' },
  });
}
