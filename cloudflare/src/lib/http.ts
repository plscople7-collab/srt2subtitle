export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=UTF-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function error(status: number, code: string, message: string): Response {
  return json({ error: code, message }, { status });
}

export async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

export function notFound(): Response {
  return json({ error: "NOT_FOUND" }, { status: 404 });
}
