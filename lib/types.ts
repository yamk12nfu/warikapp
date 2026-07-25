// 画面用の型(Convexスキーマの expenses.items と対応)。
// Convex側の Id<"members"> は string のサブタイプなので、サーバーで読んだ
// ドキュメントをそのままこの型として扱える(lib/settlement.ts で共用する)。

export type ShareRatio = {
  memberId: string;
  ratioPercent: number; // 0〜100の整数。1品目の合計が100(V-401)
};

export type ExpenseItemInput = {
  name: string;
  price: number; // 円・整数
  quantity: number;
  shares: ShareRatio[];
};
