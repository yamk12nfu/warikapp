"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.warn("サービスワーカーを登録できませんでした", error);
    });
  }, []);

  return null;
}
