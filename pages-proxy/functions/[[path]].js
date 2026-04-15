export async function onRequest(context) {
  const headers = new Headers(context.request.headers);
  headers.set("x-public-origin", new URL(context.request.url).origin);

  const upstreamRequest = new Request(context.request, {
    headers,
  });

  return context.env.BACKEND.fetch(upstreamRequest);
}
