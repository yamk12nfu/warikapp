"use client";

import { api } from "@/convex/_generated/api";
import { toUserMessage } from "@/lib/convex-error";
import { urlBase64ToUint8Array } from "@/lib/push";
import { primaryButtonClass } from "@/lib/ui";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState, useSyncExternalStore } from "react";

function arrayBufferToBase64Url(value: ArrayBuffer | null): string {
  if (value === null) {
    throw new Error("通知の購読情報を読み取れません");
  }
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window &&
    "serviceWorker" in navigator
  );
}

function subscribeToPushSupport() {
  return () => {};
}

function getPushSupportServerSnapshot(): boolean | null {
  return null;
}

export default function PushNotificationSettings() {
  const vapidPublicKey = useQuery(api.push.vapidPublicKey, {});
  const [subscription, setSubscription] =
    useState<PushSubscription | null>(null);
  const supported = useSyncExternalStore(
    subscribeToPushSupport,
    isPushSupported,
    getPushSupportServerSnapshot,
  );
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] =
    useState<NotificationPermission | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const endpoint = subscription?.endpoint;
  const serverSubscribed = useQuery(
    api.push.isSubscribed,
    endpoint === undefined ? "skip" : { endpoint },
  );
  const subscribe = useMutation(api.push.subscribe);
  const unsubscribe = useMutation(api.push.unsubscribe);
  const enabled = subscription !== null && serverSubscribed === true;
  const statusLoading =
    supported === true &&
    (!initialized ||
      vapidPublicKey === undefined ||
      (endpoint !== undefined && serverSubscribed === undefined));

  useEffect(() => {
    if (supported !== true) {
      return;
    }

    let cancelled = false;
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((current) => {
        if (!cancelled) {
          setSubscription(current);
          setPermission(Notification.permission);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage("通知の状態を確認できませんでした");
          console.warn("通知の購読状態を取得できませんでした", error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setInitialized(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [supported]);

  async function handleToggle() {
    if (supported !== true || vapidPublicKey == null) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (enabled) {
        const current = subscription;
        if (current !== null) {
          await current.unsubscribe();
          await unsubscribe({ endpoint: current.endpoint });
        }
        setSubscription(null);
        setMessage("通知をオフにしました");
        return;
      }

      const requestedPermission = await Notification.requestPermission();
      setPermission(requestedPermission);
      if (requestedPermission !== "granted") {
        setMessage(
          "通知が許可されませんでした。ブラウザーの設定から通知を許可してください。",
        );
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const next =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));
      await subscribe({
        endpoint: next.endpoint,
        keys: {
          p256dh: arrayBufferToBase64Url(next.getKey("p256dh")),
          auth: arrayBufferToBase64Url(next.getKey("auth")),
        },
      });
      setSubscription(next);
      setMessage("通知をオンにしました");
    } catch (caught) {
      setMessage(toUserMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted">通知</h2>
      {supported === false ? (
        <p className="text-sm text-muted">
          この端末では通知を使えません。iPhone はホーム画面に追加したアプリから開いてください
        </p>
      ) : supported === null || statusLoading ? (
        <p className="text-sm text-muted">通知の状態を確認中…</p>
      ) : vapidPublicKey === null ? (
        <>
          <p className="text-sm text-muted">通知の準備ができていません</p>
          <button
            type="button"
            disabled
            className={`${primaryButtonClass} w-full`}
          >
            精算の確認依頼を通知する
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="精算の確認依頼を通知する"
            disabled={busy || statusLoading}
            onClick={handleToggle}
            className={`${primaryButtonClass} flex w-full items-center justify-between`}
          >
            <span>精算の確認依頼を通知する</span>
            <span>{enabled ? "オン" : "オフ"}</span>
          </button>
          {permission === "denied" && !enabled && (
            <p className="text-sm text-muted">
              通知が拒否されています。ブラウザーの設定から通知を許可してください。
            </p>
          )}
        </>
      )}
      {message !== null && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
    </section>
  );
}
