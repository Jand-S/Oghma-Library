import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SourceSite } from "../../core/types";
import { SourcesView } from "../../features/sources/SourcesView";
import { normalizeRequestUrl, type SourceRequest } from "../../services/sourceRequests";
import { sourcesStrings } from "../../strings/sources";

const strings = sourcesStrings.request;

function request(patch: Partial<SourceRequest>): SourceRequest {
  return {
    id: "a1b2c3d4e5", domain: "novos-livros.com", url: "https://novos-livros.com/novel/x", novelUrl: "https://novos-livros.com/novel/x",
    status: "building", stage: "analyzing", stageLabel: "Analisando o site", stageIndex: 3, stagesTotal: 7,
    queuePosition: null, novelTitle: null, sourceId: null, message: "", createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), ...patch
  };
}

const central: SourceSite = {
  id: "central-novel", name: "Central Novel", baseUrl: "https://centralnovel.com/", enabled: true,
  count: 10, lastSync: "", status: "online"
} as SourceSite;

function view(requests: SourceRequest[], extra: Partial<Parameters<typeof SourcesView>[0]> = {}) {
  const sourceRequests = { requests, error: null, refresh: vi.fn(), submit: vi.fn(), dismiss: vi.fn() };
  render(
    <SourcesView sources={[central]} syncing={[]} onToggle={vi.fn()} onSync={vi.fn()} onOpenSettings={vi.fn()}
      sourceRequests={sourceRequests} {...extra} />
  );
  return sourceRequests;
}

describe("Pedidos de fonte nova", () => {
  it("aceita endereço sem https e recusa texto que não é endereço", () => {
    expect(normalizeRequestUrl("site.com/novel/x")).toBe("https://site.com/novel/x");
    expect(normalizeRequestUrl("nada")).toBeNull();
    expect(normalizeRequestUrl("")).toBeNull();
  });

  it("mostra a fonte em construção como uma linha com etapa e switch desativado", () => {
    view([request({})]);
    const row = screen.getByTestId("pending-source-row");
    expect(within(row).getByText("novos-livros.com")).toBeInTheDocument();
    expect(within(row).getByTestId("pending-source-badge")).toHaveTextContent(strings.building);
    expect(within(row).getByTestId("pending-source-stage")).toHaveTextContent("Analisando o site");
    expect(within(row).getByRole("switch")).toBeDisabled();
    expect(within(row).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
  });

  it("mostra a posição na fila", () => {
    view([request({ status: "queued", stage: "queued", stageLabel: "Na fila para construção", stageIndex: 2, queuePosition: 2 })]);
    expect(screen.getByTestId("pending-source-stage")).toHaveTextContent(strings.queue(2));
  });

  it("sem plano de IA livre mostra quando volta, não a posição na fila", () => {
    view([request({ status: "queued", stage: "waiting_plan", stageLabel: "Aguardando plano", stageIndex: 2, queuePosition: 1,
      message: "Aguardando plano, volta às 14:30" })]);
    expect(screen.getByTestId("pending-source-stage")).toHaveTextContent("Aguardando plano, volta às 14:30");
    expect(screen.getByTestId("pending-source-badge")).toHaveTextContent(strings.building);
  });

  it("fonte pronta que ainda não está na lista: botão Adicionar e sincronizar", () => {
    const onAddSource = vi.fn();
    view([request({ status: "live", stage: "live", stageLabel: "Pronta para adicionar", stageIndex: 7, sourceId: "novos-livros" })], { onAddSource });
    fireEvent.click(screen.getByRole("button", { name: strings.addAndSync }));
    expect(onAddSource).toHaveBeenCalledWith("novos-livros");
  });

  it("fonte pronta que já chegou no índice vira linha normal com o destaque Nova", () => {
    const onAddSource = vi.fn();
    const fresh = { ...central, id: "novos-livros", name: "Novos Livros", baseUrl: "https://novos-livros.com/", enabled: false };
    render(
      <SourcesView sources={[central, fresh as SourceSite]} syncing={[]} onToggle={vi.fn()} onSync={vi.fn()} onOpenSettings={vi.fn()}
        onAddSource={onAddSource}
        sourceRequests={{ requests: [request({ status: "live", stage: "live", stageIndex: 7, sourceId: "novos-livros" })], error: null, refresh: vi.fn(), submit: vi.fn(), dismiss: vi.fn() }} />
    );
    expect(screen.queryByTestId("pending-source-row")).not.toBeInTheDocument();
    expect(screen.getByTestId("source-new")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: strings.addAndSync }));
    expect(onAddSource).toHaveBeenCalledWith("novos-livros");
  });

  it("pedido que falhou mostra o motivo e pode ser removido", () => {
    const requests = view([request({ status: "failed", stage: "failed", stageLabel: "Não foi possível criar", stageIndex: null, message: "site só tem imagens" })]);
    expect(screen.getByTestId("pending-source-stage")).toHaveTextContent("site só tem imagens");
    fireEvent.click(screen.getByRole("button", { name: strings.dismiss }));
    expect(requests.dismiss).toHaveBeenCalledWith("a1b2c3d4e5");
  });

  it("envia o pedido pelo modal e avisa", async () => {
    const onNotify = vi.fn();
    const requests = view([], { onNotify });
    requests.submit.mockResolvedValue(request({ status: "pending" }));
    fireEvent.click(screen.getByTestId("request-source-open"));
    fireEvent.change(screen.getByLabelText(strings.urlLabel), { target: { value: "novos-livros.com/novel/x" } });
    fireEvent.click(screen.getByRole("button", { name: strings.submit }));
    await waitFor(() => expect(requests.submit).toHaveBeenCalled());
    expect(requests.submit.mock.calls[0][0].url).toBe("novos-livros.com/novel/x");
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(strings.sent));
  });

  it("recusa endereço inválido sem enviar", async () => {
    const requests = view([]);
    fireEvent.click(screen.getByTestId("request-source-open"));
    fireEvent.change(screen.getByLabelText(strings.urlLabel), { target: { value: "nada" } });
    fireEvent.click(screen.getByRole("button", { name: strings.submit }));
    expect(await screen.findByText(strings.invalidUrl)).toBeInTheDocument();
    expect(requests.submit).not.toHaveBeenCalled();
  });
});
