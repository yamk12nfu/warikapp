import { ConvexError } from "convex/values";

// プロバイダ共通の設定読み取り。環境変数はConvexダッシュボードに登録する
// (.env.local ではない。actionはConvex側で実行されるため)。
// SDKに依存しないので "use node" は不要。純粋関数としてテストできる。

export type ProviderName = "claude" | "gemini";

// プロバイダごとのモデルIDの接頭辞。RECEIPT_AI_MODEL は1つしかないので、
// プロバイダを切り替えたときに前のモデルIDが残っていると噛み合わない。
// 黙って既定値に落とすと「設定したのに効かない」になるため、はっきり止める。
const MODEL_PREFIX: Record<ProviderName, string> = {
  claude: "claude",
  gemini: "gemini",
};

export function resolveModel(
  provider: ProviderName,
  configured: string | undefined,
  fallback: string,
): string {
  const model = (configured ?? "").trim();
  if (model === "") {
    return fallback;
  }
  if (!model.startsWith(MODEL_PREFIX[provider])) {
    throw new ConvexError(
      `RECEIPT_AI_MODEL(${model})が RECEIPT_AI_PROVIDER(${provider})と一致しません。Convexの環境変数を確認してください`,
    );
  }
  return model;
}

// AI側が「設定を直せば解決する」と言っているエラーを、画面に出せる文言にする。
// 汎用の「読み取りに失敗しました」に丸めると、モデルIDの綴り間違い・キーの
// 権限・課金切れのどれなのかが分からず、原因究明に時間を取られる。
// 該当しないもの(一時的な障害など)は null を返し、呼び出し側で汎用文言にする。
export function configErrorMessage(
  status: number,
  provider: ProviderName,
  model: string,
): string | null {
  const keyName = provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
  switch (status) {
    case 400:
    case 404:
      // モデルIDの綴り間違い・提供終了。型では縛れないので実行時にしか出ない
      return `AIモデル「${model}」が使えません。ConvexのRECEIPT_AI_MODELを確認してください`;
    case 401:
    case 403:
      return `AIのAPIキーが受け付けられませんでした。Convexの${keyName}を確認してください`;
    case 429:
      // 利用上限(レート制限)と残高切れの両方がここに来る
      return "AIの利用上限に達したか、残高が不足しています。時間をおくか、AIプロバイダの課金設定を確認してください";
    default:
      return null;
  }
}

// 画面用の文言(ConvexError)に置き換えるときも、元のAPIエラーは cause に残す。
// 残さないと、ログに出るのが置き換え後の文言だけになり、HTTPステータスや
// API側の説明が消える(=設定ミスの切り分けが効かなくなる)。
export function withCause<T extends Error>(error: T, cause: unknown): T {
  error.cause = cause;
  return error;
}

// ログ用のエラー説明。種別・HTTPステータス・API側の文言(先頭のみ)を出す。
// どれもリクエストの作り方に対するAPIの説明で、レシートの中身は含まれない。
// 画面用に置き換えたエラーは cause 側に元の情報があるので1段だけ辿る。
export function describeError(error: unknown, unwrapCause = true): string {
  if (!(error instanceof Error)) {
    return "error=unknown";
  }
  const status = (error as { status?: unknown }).status;
  const statusPart = typeof status === "number" ? ` status=${status}` : "";
  const base = `error=${error.name}${statusPart} message=${error.message.slice(0, 300)}`;
  if (unwrapCause && error.cause instanceof Error) {
    return `${base} cause=(${describeError(error.cause, false)})`;
  }
  return base;
}

// APIキーの未設定は「読み取り失敗」で片付けず、何を設定すればよいかを出す
// (このアプリの利用者=設定する本人なので、伏せる意味がない)。
export function requireApiKey(
  value: string | undefined,
  variableName: string,
): string {
  const apiKey = (value ?? "").trim();
  if (apiKey === "") {
    throw new ConvexError(
      `AIの設定が未完了です。Convexの環境変数に ${variableName} を登録してください`,
    );
  }
  return apiKey;
}
