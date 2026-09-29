import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uiStrings } from "../../strings/common";
import { ToastProvider, useToast, type ToastOptions } from "../../ui";

function Trigger({ options }: { options: ToastOptions | string }) {
  const { toast } = useToast();
  return <button onClick={() => toast(options)}>Notificar</button>;
}

describe("Toast", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a status toast in the notifications region and auto-dismisses", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger options={{ message: "Salvo.", duration: 1000 }} /></ToastProvider>);
    act(() => screen.getByRole("button", { name: "Notificar" }).click());

    const region = screen.getByRole("region", { name: uiStrings.notifications });
    expect(region).toContainElement(screen.getByRole("status"));
    expect(screen.getByText("Salvo.")).toBeInTheDocument();
    expect(region.querySelector(".o-toast__countdown")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.queryByText("Salvo.")).not.toBeInTheDocument();
  });

  it("uses role=alert for danger, runs the action and can be dismissed", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <ToastProvider>
        <Trigger options={{ message: "Falhou.", tone: "danger", duration: 0, action: { label: "Tentar de novo", onClick: onRetry } }} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Notificar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Falhou.");
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.queryByText("Falhou.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Notificar" }));
    await user.click(screen.getByRole("button", { name: uiStrings.dismissToast }));
    expect(screen.queryByText("Falhou.")).not.toBeInTheDocument();
  });

  it("accepts a plain string and keeps at most three toasts", async () => {
    const user = userEvent.setup();
    render(<ToastProvider><Trigger options="Oi" /></ToastProvider>);
    for (let index = 0; index < 5; index += 1) {
      await user.click(screen.getByRole("button", { name: "Notificar" }));
    }
    expect(screen.getAllByText("Oi")).toHaveLength(3);
  });
});
