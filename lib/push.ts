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
