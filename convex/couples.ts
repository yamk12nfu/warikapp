import { ConvexError, v } from "convex/values";
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireMember, requireUser } from "./lib/auth";

// 世帯(couple)は全データのテナント境界。1ユーザーは1世帯にのみ所属する(V-202)。
// 画面に出すエラーは ConvexError で投げる(本番でもメッセージがクライアントに届く)。

const DEFAULT_COUPLE_NAME = "わたしたち";
const MAX_MEMBERS = 2; // V-203: 世帯の上限2名
const INVITATION_TTL_MS = 72 * 60 * 60 * 1000; // 招待コードの有効期限72時間
const INVITATION_CODE_LENGTH = 8;
// 紛らわしい 0 / O / 1 / I / L を除いた31文字。口頭・手入力での取り違えを防ぐ
const INVITATION_CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
// 256 を 31 で割り切れる最大値。これ以上のバイトは捨てて剰余バイアスをなくす
const CODE_BYTE_LIMIT =
  256 - (256 % INVITATION_CODE_CHARS.length); /* = 248 */

const ERR_ALREADY_JOINED =
  "すでに世帯に参加しています。別の世帯に参加するには、先に既存の世帯から退出してください";
const ERR_INVALID_CODE = "招待コードが無効です";
const ERR_COUPLE_FULL = "この世帯は満員です";

function normalizeDisplayName(raw: string): string {
  const displayName = raw.trim();
  if (displayName.length < 1 || displayName.length > 20) {
    throw new ConvexError("表示名は1〜20文字で入力してください");
  }
  return displayName;
}

function normalizeCoupleName(raw: string | undefined): string {
  const coupleName = (raw ?? "").trim();
  if (coupleName.length === 0) {
    return DEFAULT_COUPLE_NAME;
  }
  if (coupleName.length > 30) {
    throw new ConvexError("世帯名は30文字以内で入力してください");
  }
  return coupleName;
}

// 入力のゆらぎ(小文字・前後の空白)を吸収してから照合する
function normalizeInvitationCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function generateInvitationCode(): string {
  let code = "";
  while (code.length < INVITATION_CODE_LENGTH) {
    const bytes = new Uint8Array(INVITATION_CODE_LENGTH);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= CODE_BYTE_LIMIT) {
        continue;
      }
      code += INVITATION_CODE_CHARS[byte % INVITATION_CODE_CHARS.length];
      if (code.length === INVITATION_CODE_LENGTH) {
        break;
      }
    }
  }
  return code;
}

// tokenIdentifier からメンバーを引く。未所属なら null(所属チェック用)
async function findMemberByToken(ctx: QueryCtx | MutationCtx, token: string) {
  return await ctx.db
    .query("members")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", token))
    .unique();
}

async function listCoupleMembers(
  ctx: QueryCtx | MutationCtx,
  coupleId: Id<"couples">,
) {
  return await ctx.db
    .query("members")
    .withIndex("by_coupleId", (q) => q.eq("coupleId", coupleId))
    .take(MAX_MEMBERS);
}

// 未使用の招待コード(再発行時に消す対象・設定画面に出す対象)。
// 再発行のたびに旧コードを削除するため、実際には高々1件しか残らない。
async function listUnusedInvitations(
  ctx: QueryCtx | MutationCtx,
  coupleId: Id<"couples">,
) {
  const invitations = await ctx.db
    .query("invitations")
    .withIndex("by_coupleId", (q) => q.eq("coupleId", coupleId))
    .order("desc")
    .take(10);
  return invitations.filter((invitation) => invitation.usedAt === undefined);
}

// 招待コードを発行する。衝突したら数回引き直す
async function issueInvitation(ctx: MutationCtx, coupleId: Id<"couples">) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInvitationCode();
    const duplicated = await ctx.db
      .query("invitations")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (duplicated !== null) {
      continue;
    }
    const expiresAt = Date.now() + INVITATION_TTL_MS;
    await ctx.db.insert("invitations", { coupleId, code, expiresAt });
    return { code, expiresAt };
  }
  throw new ConvexError(
    "招待コードを発行できませんでした。もう一度お試しください",
  );
}

// ログイン中ユーザーの世帯所属を返すルーティング用プローブ。
// 未ログイン・世帯未所属なら null(画面側で /setup へ振り分けるための状態値であり、
// 認可ゲートではない。世帯データに触る関数は requireMember の throw を使うこと)。
// 情報最小化のため、画面に必要なフィールドだけを射影して返す。
export const currentMember = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return null;
    }
    const member = await findMemberByToken(ctx, identity.tokenIdentifier);
    if (member === null) {
      return null;
    }
    return {
      _id: member._id,
      coupleId: member.coupleId,
      displayName: member.displayName,
    };
  },
});

// 設定画面(S-009)用。世帯名・メンバー・有効な招待コードを返す。
// 有効期限の判定はクライアント側で行う(query内で時刻を読むと結果が陳腐化するため、
// expiresAt をそのまま返す)。
export const household = query({
  args: {},
  handler: async (ctx) => {
    const member = await requireMember(ctx);
    const couple = await ctx.db.get("couples", member.coupleId);
    if (couple === null) {
      throw new ConvexError("世帯が見つかりません");
    }
    const members = await listCoupleMembers(ctx, member.coupleId);
    const partner = members.find((m) => m._id !== member._id) ?? null;

    // 招待コードはパートナー未参加のときだけ返す(満員なら発行済みでも使えない)
    let invitation = null;
    if (members.length < MAX_MEMBERS) {
      const unused = await listUnusedInvitations(ctx, member.coupleId);
      if (unused.length > 0) {
        invitation = { code: unused[0].code, expiresAt: unused[0].expiresAt };
      }
    }

    return {
      coupleName: couple.name,
      memberCount: members.length,
      self: { _id: member._id, displayName: member.displayName },
      // _id は支出の支払者・負担区分の選択(F-004)で使う
      partner:
        partner === null
          ? null
          : { _id: partner._id, displayName: partner.displayName },
      invitation,
    };
  },
});

// 世帯を作成し、自分を最初のメンバーとして登録して招待コードを発行する
export const createCouple = mutation({
  args: {
    displayName: v.string(),
    coupleName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireUser(ctx);
    const displayName = normalizeDisplayName(args.displayName);
    const coupleName = normalizeCoupleName(args.coupleName);

    // V-202: 1ユーザーが所属できる世帯は1つ
    const existing = await findMemberByToken(ctx, identity.tokenIdentifier);
    if (existing !== null) {
      throw new ConvexError(ERR_ALREADY_JOINED);
    }

    const coupleId = await ctx.db.insert("couples", { name: coupleName });
    await ctx.db.insert("members", {
      coupleId,
      tokenIdentifier: identity.tokenIdentifier,
      displayName,
    });
    return await issueInvitation(ctx, coupleId);
  },
});

// 招待コードで既存の世帯に参加する。mutation全体が自動でトランザクションになるため、
// 「満員チェック → 登録 → コード無効化」の間に割り込まれる心配はない。
export const joinCouple = mutation({
  args: {
    code: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireUser(ctx);
    const displayName = normalizeDisplayName(args.displayName);
    const code = normalizeInvitationCode(args.code);

    // V-201: 存在・未使用・期限内
    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (
      invitation === null ||
      invitation.usedAt !== undefined ||
      invitation.expiresAt <= Date.now()
    ) {
      throw new ConvexError(ERR_INVALID_CODE);
    }

    // V-202: 1ユーザーが所属できる世帯は1つ
    const existing = await findMemberByToken(ctx, identity.tokenIdentifier);
    if (existing !== null) {
      throw new ConvexError(ERR_ALREADY_JOINED);
    }

    // V-203: 世帯の上限2名
    const members = await listCoupleMembers(ctx, invitation.coupleId);
    if (members.length >= MAX_MEMBERS) {
      throw new ConvexError(ERR_COUPLE_FULL);
    }

    await ctx.db.insert("members", {
      coupleId: invitation.coupleId,
      tokenIdentifier: identity.tokenIdentifier,
      displayName,
    });
    // 2名に達したのでコードを無効化する
    await ctx.db.patch("invitations", invitation._id, { usedAt: Date.now() });
    return null;
  },
});

// 表示名の変更(S-009)
export const updateDisplayName = mutation({
  args: { displayName: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const displayName = normalizeDisplayName(args.displayName);
    await ctx.db.patch("members", member._id, { displayName });
    return null;
  },
});

// 招待コードの再発行(S-009)。パートナー未参加のときのみ。
// 旧コードは削除して、有効なコードが常に1つだけになるようにする。
export const reissueInvitation = mutation({
  args: {},
  handler: async (ctx) => {
    const member = await requireMember(ctx);
    const members = await listCoupleMembers(ctx, member.coupleId);
    if (members.length >= MAX_MEMBERS) {
      throw new ConvexError(ERR_COUPLE_FULL);
    }
    const unused = await listUnusedInvitations(ctx, member.coupleId);
    // 旧コードを残したまま発行する。先に削除すると issueInvitation の衝突検査を
    // すり抜けて旧コードと同じ文字列を引き当てうる(旧招待URLが復活してしまう)
    const issued = await issueInvitation(ctx, member.coupleId);
    for (const invitation of unused) {
      await ctx.db.delete("invitations", invitation._id);
    }
    return issued;
  },
});
