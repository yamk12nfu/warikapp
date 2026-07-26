"use node";

import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { createReceiptParser } from "./ai";
import { ReceiptSchemaError, type ReceiptMediaType } from "./ai/types";
import { RECEIPT_PARSE_LIMIT_NAME, rateLimiter } from "./rateLimits";
import { todayInJst } from "../lib/date";
import { normalizeParsedReceipt, type NormalizedReceipt } from "../lib/receipt";

// レシートのAI読み取り(F-003 / SR-001)。
//
// Anthropic SDK を使うため Node.js ランタイム("use node")で動かす必要があり、
// このファイルには action しか置けない(Convexのガイドライン: "use node" のファイルに
// query / mutation を同居させない)。アップロードURL発行・台帳登録の mutation は
// convex/uploads.ts に分けてある。計画書は両方を convex/receipts.ts に置く前提
// だったので、計画書側も分割に合わせて更新した。
//
// actionはDBに直接触れないので、認証・帰属検証は internal query 経由で行う。
// 画面に出すエラーは ConvexError で投げる(本番でも文言がクライアントに届く)。

const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 要件: 20MB以下

// 要件: 読み取りのタイムアウトは30秒。リトライを含めた「読み取り全体」の
// 上限なので、1回目と2回目で残り時間を分け合う(2回目にも30秒渡すと
// 合計60秒かかってしまう)。
const TOTAL_TIMEOUT_MS = 30_000;
// 残りがこれ未満ならリトライしない(投げてもタイムアウトするだけ)
const MIN_RETRY_MS = 5_000;

const ERR_IMAGE_MISSING = "画像が見つかりません。もう一度アップロードしてください";
const ERR_IMAGE_TOO_LARGE = "画像が大きすぎます(20MBまで)";
const ERR_UNREADABLE = "レシートを読み取れませんでした。撮り直してください";
const ERR_FAILED = "読み取りに失敗しました。手入力に切り替えますか?";

const ALLOWED_MEDIA_TYPES: ReceiptMediaType[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

// クライアントはJPEGに再エンコードして送るが、念のため実際のContent-Typeを見る。
// 判別できない場合はJPEGとして送る(AI側は中身から判断できる)。
function toMediaType(blobType: string): ReceiptMediaType {
  const found = ALLOWED_MEDIA_TYPES.find((type) => type === blobType);
  return found ?? "image/jpeg";
}

export const parse = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<NormalizedReceipt> => {
    // 1. 認証 + storageId が自世帯のものか(actionはDBに触れないので internal query)
    const { coupleId } = await ctx.runQuery(internal.uploads.authorizeUpload, {
      storageId: args.storageId,
    });

    // 2. レート制限(30回/時/世帯)。AI呼び出しの前に消費する
    //    (失敗した呼び出しも回数に数える = 連打による暴走を止めるのが目的)
    const limit = await rateLimiter.limit(ctx, RECEIPT_PARSE_LIMIT_NAME, {
      key: coupleId,
    });
    if (!limit.ok) {
      const minutes = Math.max(1, Math.ceil(limit.retryAfter / 60_000));
      throw new ConvexError(
        `読み取りの回数制限に達しました。約${minutes}分後にもう一度お試しください`,
      );
    }

    // 3. 画像を取得して base64 化
    const blob = await ctx.storage.get(args.storageId);
    if (blob === null) {
      throw new ConvexError(ERR_IMAGE_MISSING);
    }
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new ConvexError(ERR_IMAGE_TOO_LARGE);
    }
    const imageBase64 = Buffer.from(await blob.arrayBuffer()).toString("base64");

    // 4. AI抽出。スキーマ不適合のときだけ1回リトライする(要件 F-003)。
    //    タイムアウトは2回の合計で30秒に収める
    const parser = createReceiptParser();
    const mediaType = toMediaType(blob.type);
    const startedAt = Date.now();
    const deadline = startedAt + TOTAL_TIMEOUT_MS;
    let parsed;
    try {
      try {
        parsed = await parser.parse(imageBase64, mediaType, {
          timeoutMs: TOTAL_TIMEOUT_MS,
        });
      } catch (caught) {
        const remaining = deadline - Date.now();
        if (!(caught instanceof ReceiptSchemaError) || remaining < MIN_RETRY_MS) {
          throw caught;
        }
        parsed = await parser.parse(imageBase64, mediaType, {
          timeoutMs: remaining,
        });
      }
    } catch (caught) {
      // ログにレシートの中身は出さない(要件 5.4)。出すのは成否・所要時間・
      // プロバイダ名と、API側のエラー種別だけ
      console.error(
        `receipts.parse failed provider=${parser.providerName} ms=${Date.now() - startedAt} error=${caught instanceof Error ? caught.name : "unknown"}`,
      );
      if (caught instanceof ConvexError) {
        throw caught; // 未実装プロバイダなど、そのまま画面に出してよいもの
      }
      throw new ConvexError(ERR_FAILED);
    }

    // 5. 品目合計 ≠ 合計金額 なら差額を「調整(税・割引等)」として品目に足す
    const normalized = normalizeParsedReceipt(parsed, todayInJst());

    // 判定はAI由来の品目数(調整行を足す前)で行う。items の件数で見ると、
    // 品目0件でも合計金額だけ返ってきたときに「調整行だけの支出」ができてしまう
    if (normalized.sourceItemCount === 0) {
      // レシート以外の画像・不鮮明な画像。画面は撮り直し+手入力導線を出す
      console.error(
        `receipts.parse unreadable provider=${parser.providerName} ms=${Date.now() - startedAt}`,
      );
      throw new ConvexError(ERR_UNREADABLE);
    }

    console.log(
      `receipts.parse ok provider=${parser.providerName} ms=${Date.now() - startedAt} items=${normalized.items.length}`,
    );
    return normalized;
  },
});
