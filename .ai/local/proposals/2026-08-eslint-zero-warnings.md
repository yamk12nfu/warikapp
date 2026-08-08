---
# yaml-language-server: $schema=../../managed/schemas/proposal.schema.json
schema_version: 1
id: eslint-zero-warnings
status: done
proposed_at_commit: 625022d6cae33f50ec639a97b0360ee89a1c07b9
sources:
  - path: "eslint.config.mjs"
  - path: "convex/auth.config.ts"
decision:
  by: yamk12nfu
---

## 課題

`npm run lint` が warning 5 件を報告しており、lint 出力がゼロでないため
「新しい警告が増えたこと」に気づきにくい状態になっている。内訳は 2 種類:

1. `convex/_generated/` 配下の 4 ファイル(api.js / dataModel.d.ts / server.d.ts /
   server.js)の `Unused eslint-disable directive` 警告。これらは Convex codegen の
   生成物であり、人間が編集するファイルではないのに lint 対象に含まれている。
   `eslint.config.mjs` の `globalIgnores` は `.next/**` 等のみで、
   `convex/_generated/**` が含まれていない。
2. `convex/auth.config.ts:3` の `import/no-anonymous-default-export` 警告。
   設定オブジェクトを匿名のまま `export default` している。

## 提案

lint warning をゼロにする。1 つの明確な改善として次の 2 点をまとめて行う:

1. `eslint.config.mjs` の `globalIgnores` に `convex/_generated/**` を追加し、
   codegen 生成物を lint 対象から除外する
2. `convex/auth.config.ts` で設定オブジェクトを名前付き変数
   (例: `const authConfig = {...}; export default authConfig;`)に変更する

## 想定する変更範囲

- `eslint.config.mjs`(1 行追加)と `convex/auth.config.ts`(2 行程度の変更)の
  計 2 ファイル。どちらも `allowed_paths` 内で、`max_changed_files: 40` に収まる。

## リスク・見送る理由になりうる点

- `convex/auth.config.ts` は本番の Clerk 認証連携の設定ファイル。変更内容は
  変数に名前を付けるだけで動作は変わらないはずだが、認証まわりを触ること自体を
  避けたい判断はありうる(デプロイ失敗時の影響が大きい)。
- `convex/_generated/**` を ignore すると、将来 codegen の出力に本物の lint 違反が
  混入しても検出されなくなる。ただし生成物の lint 違反は手元で直すべきものではなく、
  Convex 側の問題なので、実害は小さい。
- 警告のまま放置しても現状ビルド・デプロイは通っており、緊急性はない。
