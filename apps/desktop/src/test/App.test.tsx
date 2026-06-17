import {
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { App } from "../App";
import { defaultAppConfig, setupCompleteKey, setupStorageKey } from "../core/appConfig";
import type { BackendClient } from "../services/backendClient";
import { mockBackendClient } from "../services/mockBackend";

function seedSetup(config = defaultAppConfig(["central-novel", "novel-mania"])) {
  window.localStorage.setItem(setupStorageKey, JSON.stringify(config));
  window.localStorage.setItem(setupCompleteKey, "1");
}

async function renderReadyApp(backend: BackendClient = mockBackendClient) {
  seedSetup();
  render(<App backend={backend} />);
  await findBookCardTitle("The Enchanted Forest");
}

async function findBookCardTitle(title: string) {
  let cardTitle: HTMLElement | undefined;
  await waitFor(() => {
    cardTitle = screen.queryAllByText(title).find((element) => element.closest(".book-card"));
    expect(cardTitle).toBeTruthy();
  }, { timeout: 5000 });
  return cardTitle as HTMLElement;
}

async function selectFirstBook(user: ReturnType<typeof userEvent.setup>) {
  const cardTitle = await findBookCardTitle("The Enchanted Forest");
  await user.click(cardTitle as HTMLElement);
  const panel = screen.getByText("Capitulos").closest("aside") as HTMLElement;
  await waitFor(() => {
    expect(within(panel).getByText("The Enchanted Forest")).toBeInTheDocument();
  });
  return panel;
}

async function expandSelectionCard(user: ReturnType<typeof userEvent.setup>, panel: HTMLElement, title = "The Enchanted Forest") {
  const toggle = within(panel).getByRole("button", { name: `Expandir configuracao de ${title}` });
  await user.click(toggle);
  await waitFor(() => {
    expect(within(panel).getByRole("button", { name: `Recolher configuracao de ${title}` })).toBeInTheDocument();
  });
}

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("dispatches window control actions outside the Tauri runtime", async () => {
    const user = userEvent.setup();
    const listener = vi.fn();
    window.addEventListener("oghma-window-action", listener);
    seedSetup();
    render(<App backend={mockBackendClient} />);

    await user.click(screen.getByLabelText("Minimizar"));
    await user.click(screen.getByLabelText("Maximizar"));
    await user.click(screen.getByLabelText("Fechar"));

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual(["minimize", "maximize", "close"]);
    window.removeEventListener("oghma-window-action", listener);
  });

  it("guides the first opening through the onboarding wizard", async () => {
    const user = userEvent.setup();
    render(<App backend={mockBackendClient} />);

    expect(await screen.findByRole("heading", { name: "Bem-vindo" }, { timeout: 5000 })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Proximo" }));
    expect(screen.getByLabelText("Servidor de index")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Verificar servidor" }));
    expect(await screen.findByText("3 disponiveis")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Proximo" }));
    expect(screen.getByLabelText("Pasta local de saida")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Proximo" }));
    expect(screen.getByText("Selecione as fontes para indexar")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Proximo" }));
    expect(screen.getByText("Preferencias iniciais")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Proximo" }));
    expect(screen.getByText("Resumo da configuracao")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Concluir e baixar indices" }));
    expect(screen.getByText("Sincronizacao inicial dos indices")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Entrar no app" })).toBeEnabled();
    }, { timeout: 8000 });
    await user.click(screen.getByRole("button", { name: "Entrar no app" }));

    expect(await screen.findByText("Resultados")).toBeInTheDocument();
    expect(window.localStorage.getItem(setupCompleteKey)).toBe("1");
  }, 15000);

  it("loads the discover screen from the mock backend", async () => {
    await renderReadyApp();

    expect(screen.getByText("Resultados")).toBeInTheDocument();
    expect(await findBookCardTitle("The Enchanted Forest")).toBeInTheDocument();
    expect(screen.queryByText("Capitulos")).not.toBeInTheDocument();
    expect(screen.getByText("Kindle conectado")).toBeInTheDocument();
  });

  it("uses a single filter toggle and removes the filter panel when hidden", async () => {
    const user = userEvent.setup();
    await renderReadyApp();

    expect(screen.getByRole("heading", { name: "Filtros" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /filtros/i })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Ocultar filtros" }));

    expect(screen.queryByRole("heading", { name: "Filtros" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filtros" })).toBeInTheDocument();
  });

  it("selects a novel by clicking the whole card", async () => {
    const user = userEvent.setup();
    await renderReadyApp();

    const panel = await selectFirstBook(user);
    expect(panel).toBeTruthy();
  });

  it("shows format chips and translate/audiobook options in a draggable card", async () => {
    const user = userEvent.setup();
    await renderReadyApp();

    const panel = await selectFirstBook(user);
    expect(within(panel).queryByText("Formatos")).not.toBeInTheDocument();

    await expandSelectionCard(user, panel);

    expect(within(panel).getByText("Formatos")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "EPUB" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Traduzir/ })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Audiobook/ })).toBeInTheDocument();

    const card = panel.querySelector(".selection-card");
    expect(card?.getAttribute("data-card-id")).toBeTruthy();
    expect(panel.querySelector(".drag-handle")).not.toBeNull();
  });

  it("supports selecting multiple download formats", async () => {
    const user = userEvent.setup();
    await renderReadyApp();

    const panel = await selectFirstBook(user);
    await expandSelectionCard(user, panel);
    const epub = within(panel).getByRole("button", { name: "EPUB" });
    const pdf = within(panel).getByRole("button", { name: "PDF" });

    expect(epub.className).toContain("active");
    expect(pdf.className).not.toContain("active");

    await user.click(pdf);

    expect(pdf.className).toContain("active");
    expect(epub.className).toContain("active");
  });

  it("defaults the chapter preset to Todos", async () => {
    const user = userEvent.setup();
    await renderReadyApp();

    const panel = await selectFirstBook(user);
    await expandSelectionCard(user, panel);
    const todos = within(panel).getByRole("button", { name: "Todos" });
    expect(todos.className).toContain("active");
  });

  it("clears all completed downloads without requiring selection", async () => {
    const user = userEvent.setup();
    await renderReadyApp();

    await user.click(screen.getByRole("button", { name: "Downloads" }));
    expect(screen.getByText("Whispers of the Night")).toBeInTheDocument();
    expect(screen.getByText("The Labyrinth's Secret")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Limpar" }));

    expect(screen.queryByText("Whispers of the Night")).not.toBeInTheDocument();
    expect(screen.queryByText("The Labyrinth's Secret")).not.toBeInTheDocument();
  });

  it("moves conversion actions to the local library", async () => {
    const user = userEvent.setup();
    await renderReadyApp();

    await user.click(screen.getByRole("button", { name: "Biblioteca" }));
    expect(screen.getByRole("heading", { name: "Filtros" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ocultar filtros" }));
    expect(screen.queryByRole("heading", { name: "Filtros" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filtros" }));
    expect(screen.getByRole("heading", { name: "Filtros" })).toBeInTheDocument();
    expect(screen.queryByText("Sinopse")).not.toBeInTheDocument();

    const title = screen.getAllByText("To Kill a Mockingbird").find((element) => element.closest(".library-book-card")) as HTMLElement;
    const card = title.closest(".library-book-card") as HTMLElement;
    expect(card.querySelector<HTMLElement>(".book-cover")?.style.backgroundImage).toContain("oghma-icon.svg");

    await user.click(title);
    const detail = screen.getByText("Sinopse").closest(".library-detail-panel") as HTMLElement;
    expect(detail.querySelector<HTMLElement>(".detail-cover")?.style.backgroundImage).toContain("oghma-icon.svg");
    expect(screen.getByRole("button", { name: "Converter" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Converter" }));

    expect(screen.getByRole("heading", { name: "Converter downloads" })).toBeInTheDocument();
    expect(screen.getAllByText("To Kill a Mockingbird").some((element) => element.closest(".modal-panel"))).toBe(true);
  });
});
