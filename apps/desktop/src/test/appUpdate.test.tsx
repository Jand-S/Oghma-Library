import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UpdateButton } from "../features/update/UpdateButton";
import { useAppUpdate, type UpdaterApi } from "../features/update/useAppUpdate";
import { updateStrings as s } from "../strings/update";
import { setupUser } from "./renderApp";

function Harness({ api, onReady }: { api: UpdaterApi | null; onReady: (check: () => Promise<void>) => void }) {
  const update = useAppUpdate(api);
  onReady(update.checkNow);
  return <UpdateButton update={update} />;
}

describe("app update", () => {
  it("stays hidden without a newer version", async () => {
    let check: () => Promise<void> = async () => undefined;
    render(<Harness api={{ check: async () => null, relaunch: vi.fn() }} onReady={(fn) => (check = fn)} />);
    await act(() => check());
    expect(screen.queryByTestId("update-button")).not.toBeInTheDocument();
  });

  it("shows the button, the notes, the progress, and relaunches after installing", async () => {
    const user = setupUser();
    const relaunch = vi.fn(async () => undefined);
    const downloadAndInstall = vi.fn(async (onEvent?: (event: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 100 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 60 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
      onEvent?.({ event: "Finished" });
    });
    const api: UpdaterApi = { check: async () => ({ version: "2.0.1", body: "Correções na biblioteca.", downloadAndInstall }), relaunch };
    let check: () => Promise<void> = async () => undefined;
    render(<Harness api={api} onReady={(fn) => (check = fn)} />);
    await act(() => check());

    await user.click(screen.getByTestId("update-button"));
    expect(screen.getByRole("dialog", { name: s.dialogTitle("2.0.1") })).toBeInTheDocument();
    expect(screen.getByText("Correções na biblioteca.")).toBeInTheDocument();
    await user.click(screen.getByTestId("update-install"));
    await waitFor(() => expect(relaunch).toHaveBeenCalled());
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
  });

  it("offers a retry when the install fails", async () => {
    const user = setupUser();
    const api: UpdaterApi = {
      check: async () => ({ version: "2.0.1", downloadAndInstall: async () => { throw new Error("assinatura inválida"); } }),
      relaunch: vi.fn()
    };
    let check: () => Promise<void> = async () => undefined;
    render(<Harness api={api} onReady={(fn) => (check = fn)} />);
    await act(() => check());
    await user.click(screen.getByTestId("update-button"));
    await user.click(screen.getByTestId("update-install"));
    expect(await screen.findByText("assinatura inválida")).toBeInTheDocument();
    expect(screen.getByTestId("update-install")).toHaveTextContent(s.retry);
    expect(api.relaunch).not.toHaveBeenCalled();
  });
});
