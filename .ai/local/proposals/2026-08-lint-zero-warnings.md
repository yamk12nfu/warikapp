---
# yaml-language-server: $schema=../../managed/schemas/proposal.schema.json
schema_version: 1
id: lint-zero-warnings
status: open
proposed_at_commit: 625022d6cae33f50ec639a97b0360ee89a1c07b9
sources:
  - path: "eslint.config.mjs"
  - path: "convex/auth.config.ts"
decision:
  by: ""
  reason: ""
---

## 課題

`npm run lint` が常時5件の警告を出す:

- `convex/_generated/` 配下の4ファイル（`api.js` / `dataModel.d.ts` / `server.d.ts` /
  `server.js`）で "Unused eslint-disable directive"。これらは Convex CLI の生成物で
  人間も AI も編集しないファイルだが、`eslint.config.mjs` の `globalIgnores` に
  含まれていないため lint 対象になっている。
- `convex/auth.config.ts` で `import/no-anonymous-default-export`
  （オブジェクトリテラルを直接 default export している）。

警告が常在すると「lint はいつも5件出るもの」となり、新しく混入した警告が
埋もれて気づけない。quality gate の lint は警告ゼロを基準にできる状態が望ましい。

## 提案

警告を5件→0件にする:

1. `eslint.config.mjs` の `globalIgnores` に `convex/_generated/**` を追加する
   （`convex/tsconfig.json` も `_generated` を exclude しており、生成物を検査対象外と
   する方針として一貫する）
2. `convex/auth.config.ts` の設定オブジェクトをいったん変数に代入してから
   default export する形に書き換える（挙動は等価）

## 想定する変更範囲

`eslint.config.mjs` と `convex/auth.config.ts` の2ファイル。
いずれも `ai.allowed_paths`（`*.config.*` / `convex/**`）の範囲内で、
improve プロンプトでそのまま実装可能。

## リスク・見送る理由になりうる点

- `convex/_generated/**` を ignore すると生成物への lint 検査が完全に無効になる。
  生成物の品質は Convex CLI に委ねる前提が必要（ただし現状の警告自体が
  「生成物を lint する意味の薄さ」の表れでもある）。
- `convex/auth.config.ts` は Clerk 認証の設定ファイル。変更は機械的な等価
  リファクタだが、認証まわりに触る diff である以上、レビューは慎重に行う必要がある。
  「警告1件のために認証設定ファイルを触りたくない」という判断はあり得る
  （その場合は ignore 追加のみの縮小採用も可能）。
