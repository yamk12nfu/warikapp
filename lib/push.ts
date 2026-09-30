import { formatYen } from "./format";

export function buildSettlementRequestPayload({
  actorName,
  amount,
  expenseCount,
}: {
  actorName: string;
  amount: number;
  expenseCount: number;
}) {
  return {
    title: "精算の確認依頼",
    body: `${actorName}さんが ${formatYen(amount)}(${expenseCount}件)の精算を開始しました。内容を確認してください`,
    url: "/settlement",
    tag: "settlement-request",
  };
}

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function shouldDropSubscription(
  statusCode: number | undefined,
): boolean {
  return statusCode === 404 || statusCode === 410;
}

const MAX_ENDPOINT_LENGTH = 2048;

// 購読の endpoint はクライアントが自由に送ってくる値で、サーバーはそこへ
// HTTPS リクエストを出す。内部アドレスを登録されて SSRF に使われないよう、
// https の公開ホスト名だけを受け付ける(IP リテラルと localhost 系は拒否)
export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.startsWith("[") ||
    /^\d+(\.\d+){3}$/.test(host) ||
    !host.includes(".")
  ) {
    return false;
  }
  return true;
}
