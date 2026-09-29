import { NextResponse, type NextRequest } from "next/server";
import { accessTokenIsExpired } from "@/lib/session";

export function middleware(request: NextRequest): NextResponse {
  const access = request.cookies.get("cf_access")?.value;
  if (access === undefined || !accessTokenIsExpired(access)) {
    return NextResponse.next();
  }
  const response = NextResponse.next();
  response.cookies.delete("cf_access");
  response.cookies.delete("cf_refresh");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
