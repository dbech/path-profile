export const dynamic = "force-static";

export function GET() {
  return disabledResponse();
}

export function POST() {
  return disabledResponse();
}

function disabledResponse() {
  return Response.json(
    { error: "tRPC is disabled for the desktop path profile app." },
    { status: 404 },
  );
}
