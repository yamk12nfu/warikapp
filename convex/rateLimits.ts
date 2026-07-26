import { RateLimiter, HOUR } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

// AI読み取りの回数制限(要件 F-003: 1世帯あたり30回/時)。
//
// 計画書は「直近1時間の parseLogs を数えて30件以上なら例外」という素朴な実装を
// 想定していたが、次の2点から @convex-dev/rate-limiter コンポーネントに置き換えた:
//   1. 件数カウントに必要な .collect().length はガイドラインで禁止されている
//      (Convexに件数演算子はなく、行が増えるほど読み取り量が伸びる)。
//      .take(31) で頭打ちにする手もあるが、下の2.が残る。
//   2. ログ行を貯める方式は parseLogs が無限に増え続ける。掃除のcronを別途
//      用意することになるが、コンポーネントは「世帯ごとに1行の集計値」しか
//      持たないので、そもそも溜まらない。
// ガイドラインが per-key quota にこのコンポーネントを推奨しているのもこの理由。
// これに伴い parseLogs テーブルは廃止した(schema.ts から削除)。
//
// 方式は fixed window(1時間ごとにリセット)。token bucket と違い
// 「1時間で30回」を素直に表現でき、ユーザーへの説明もしやすい。
export const RECEIPT_PARSE_LIMIT_NAME = "receiptParse";

// アップロードURLの発行にも枠を設ける。読み取りを呼ばずにURL発行だけを
// 繰り返せば、読み取りの制限を迂回して無制限にファイルを置けてしまうため。
// 圧縮のやり直しや再試行があるので、読み取りの上限より緩め(2倍)にしてある。
export const RECEIPT_UPLOAD_LIMIT_NAME = "receiptUpload";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  [RECEIPT_PARSE_LIMIT_NAME]: { kind: "fixed window", rate: 30, period: HOUR },
  [RECEIPT_UPLOAD_LIMIT_NAME]: { kind: "fixed window", rate: 60, period: HOUR },
});
