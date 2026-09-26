// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./Toast";

function ToastConsumer() {
  const { show } = useToast();

  return (
    <button type="button" onClick={() => show("支出を登録しました")}>
      成功を表示
    </button>
  );
}

describe("ToastProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("shows the message and dismisses it after three seconds", () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "成功を表示" }));
    expect(screen.getByRole("status").textContent).toBe("支出を登録しました");

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("restarts the dismissal timer when the same message is shown again", () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>,
    );

    const button = screen.getByRole("button", { name: "成功を表示" });
    fireEvent.click(button);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    fireEvent.click(button);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole("status").textContent).toBe("支出を登録しました");

    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(screen.getByRole("status").textContent).toBe("支出を登録しました");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("throws a clear error when used outside the provider", () => {
    expect(() => render(<ToastConsumer />)).toThrow(
      "useToast must be used within a ToastProvider",
    );
  });
});
