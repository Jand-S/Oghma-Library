// Pedidos de fonte nova: vão para o brain.jandson.me, que os mostra ao Jandson para
// aprovar; o servidor local cria o conector e cada etapa volta para cá como status.
import { getErrorMessage } from "./backendClient";

export const SOURCE_REQUESTS_URL = "https://brain.jandson.me/api/public/oghma/source-requests";
/** Só identifica o app para o filtro anti-robô do brain; não é segredo. */
const APP_KEY = "oghma-desktop-1";
const IDS_KEY = "oghma.sourceRequests.v1";
const REQUESTER_KEY = "oghma.requester.v1";

export type SourceRequestStatus = "pending" | "queued" | "building" | "live" | "failed" | "rejected";

export type SourceRequest = {
  id: string;
  domain: string;
  url: string;
  novelUrl: string | null;
  status: SourceRequestStatus;
  stage: string;
  stageLabel: string;
  stageIndex: number | null;
  stagesTotal: number;
  queuePosition: number | null;
  novelTitle: string | null;
  sourceId: string | null;
  message: string;
  /** Quando o pedido volta a ser construído (esperando plano), ISO. */
  retryAt?: string | null;
  createdAt: string;
  updatedAt: string;
  duplicate?: boolean;
};

export type NewSourceRequest = { url: string; note?: string; requester?: string };

function readIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(IDS_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeIds(ids: string[]) {
  try {
    localStorage.setItem(IDS_KEY, JSON.stringify(ids.slice(-50)));
  } catch {
    // Sem localStorage o pedido continua valendo; só some da lista do usuário.
  }
}

export const myRequestIds = readIds;

export function forgetRequest(id: string) {
  writeIds(readIds().filter((item) => item !== id));
}

export function savedRequester(): string {
  try {
    return localStorage.getItem(REQUESTER_KEY) || "";
  } catch {
    return "";
  }
}

/** Normaliza o que a pessoa colou: aceita "site.com/novel/x" sem https. */
export function normalizeRequestUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

async function parse(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : "";
    throw new Error(message || `O servidor de pedidos respondeu ${response.status}.`);
  }
  return body;
}

export async function requestSource(input: NewSourceRequest, fetchImpl: typeof fetch = fetch): Promise<SourceRequest> {
  const url = normalizeRequestUrl(input.url);
  if (!url) throw new Error("Cole o endereço do site ou da novel (ex.: https://site.com/novel/nome).");
  try {
    if (input.requester) localStorage.setItem(REQUESTER_KEY, input.requester);
  } catch {
    // ignore
  }
  try {
    const response = await fetchImpl(SOURCE_REQUESTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Oghma-App": APP_KEY },
      body: JSON.stringify({ url, note: input.note ?? "", requester: input.requester ?? "" })
    });
    const request = (await parse(response)) as SourceRequest;
    writeIds([...readIds().filter((id) => id !== request.id), request.id]);
    return request;
  } catch (error) {
    throw new Error(getErrorMessage(error, "Não foi possível enviar o pedido. Tente de novo mais tarde."));
  }
}

/** Os pedidos deste usuário mais todos os que estão em construção (para todos verem). */
export async function listSourceRequests(fetchImpl: typeof fetch = fetch): Promise<SourceRequest[]> {
  const ids = readIds();
  const query = ids.length ? `?ids=${encodeURIComponent(ids.join(","))}` : "";
  const response = await fetchImpl(`${SOURCE_REQUESTS_URL}${query}`, { headers: { Accept: "application/json" } });
  const body = (await parse(response)) as { requests?: SourceRequest[] };
  return Array.isArray(body.requests) ? body.requests : [];
}
