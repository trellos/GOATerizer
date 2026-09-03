/**
 * Writing a scenario back to `docs/scenarios/`.
 *
 * The other half of this is the dev-server route in `vite.config.ts`, which
 * exists only while `vite` is serving. That is the whole deployment story: the
 * editor is a local authoring tool, its output is a file in the repository, and
 * a built site has no route to write one. When the route is not there the reply
 * is not JSON — the dev server answers a missing API path with the app's own
 * `index.html` — and that is what "not running locally" looks like here.
 */

/** Shared by hand with `vite.config.ts`: one side is Node, the other a browser. */
const SCENARIO_API = "/__goaterizer/scenario/";

export type SaveResult = { ok: true; path: string } | { ok: false; error: string };

const NOT_LOCAL =
  "no dev-server file API — the editor writes to docs/scenarios/ and needs `npm run dev` " +
  "running locally to do it";

async function call(id: string, init: RequestInit): Promise<SaveResult> {
  let response: Response;
  try {
    response = await fetch(`${SCENARIO_API}${encodeURIComponent(id)}`, init);
  } catch (error) {
    return { ok: false, error: `${NOT_LOCAL} (${(error as Error).message})` };
  }
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return { ok: false, error: NOT_LOCAL };

  const body = (await response.json()) as { path?: string; error?: string };
  if (!response.ok) return { ok: false, error: body.error ?? `HTTP ${response.status}` };
  return { ok: true, path: body.path ?? `docs/scenarios/${id}.scenario.json` };
}

export function saveScenarioFile(id: string, raw: unknown): Promise<SaveResult> {
  return call(id, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(raw),
  });
}

export function deleteScenarioFile(id: string): Promise<SaveResult> {
  return call(id, { method: "DELETE" });
}
