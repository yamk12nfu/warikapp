// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InviteCodeCard from "./InviteCodeCard";

const originalShareDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "share",
);

function setShare(share: ((data: ShareData) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: share,
  });
}

describe("InviteCodeCard", () => {
  afterEach(() => {
    cleanup();
    if (originalShareDescriptor === undefined) {
      Reflect.deleteProperty(navigator, "share");
    } else {
      Object.defineProperty(navigator, "share", originalShareDescriptor);
    }
  });

  it("shows copy buttons without the share button when Web Share is unavailable", () => {
    setShare(undefined);
    render(<InviteCodeCard code="ABC123" expiresAt={Date.now() + 60_000} />);

    expect(screen.queryByRole("button", { name: "共有する" })).toBeNull();
    expect(screen.getByRole("button", { name: "コードをコピー" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "招待URLをコピー" })).toBeTruthy();
  });

  it("shares the invite URL with the expected title and text", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setShare(share);
    render(<InviteCodeCard code="ABC123" expiresAt={Date.now() + 60_000} />);

    fireEvent.click(screen.getByRole("button", { name: "共有する" }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith({
      title: "warikapp への招待",
      text: "warikapp で一緒に割り勘を始めましょう。招待コード: ABC123",
      url: `${window.location.origin}/setup?code=ABC123`,
    });
  });

  it("does not show an error when the share sheet is dismissed", async () => {
    const share = vi
      .fn()
      .mockRejectedValue(new DOMException("Dismissed", "AbortError"));
    setShare(share);
    render(<InviteCodeCard code="ABC123" expiresAt={Date.now() + 60_000} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "共有する" }));
      await Promise.resolve();
    });

    expect(
      screen.queryByText(
        "共有できませんでした。招待URLをコピーして送ってください",
      ),
    ).toBeNull();
  });

  it("shows an error when sharing fails for another reason", async () => {
    const share = vi.fn().mockRejectedValue(new Error("Unavailable"));
    setShare(share);
    render(<InviteCodeCard code="ABC123" expiresAt={Date.now() + 60_000} />);

    fireEvent.click(screen.getByRole("button", { name: "共有する" }));

    expect(
      await screen.findByText(
        "共有できませんでした。招待URLをコピーして送ってください",
      ),
    ).toBeTruthy();
  });
});
