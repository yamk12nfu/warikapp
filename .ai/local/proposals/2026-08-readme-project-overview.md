---
# yaml-language-server: $schema=../../managed/schemas/proposal.schema.json
schema_version: 1
id: readme-project-overview
status: open
proposed_at_commit: 625022d6cae33f50ec639a97b0360ee89a1c07b9
sources:
  - path: "README.md"
decision:
  by: ""
  reason: ""
---

## 課題

`README.md` が create-next-app の雛形のままで、warikapp 固有の情報が一切ない
(「This is a Next.js project bootstrapped with create-next-app」で始まり、
Next.js の学習リンクで終わる)。本番稼働中のアプリでありながら、リポジトリの
入口に「何のアプリか」「どう動かすか」「必要な環境変数は何か」が書かれていない。

実際の情報は `docs/`(requirements.md / implementation-plan.md / deployment.md /
verification-checklist.md)に分散しており、初見(将来の自分・共同開発者・AI
エージェント)は README からどのドキュメントに当たればよいか分からない。

## 提案

`README.md` を warikapp 用に書き換える。内容は最小限に絞る:

1. アプリの一行説明(ふたり用の割り勘・精算アプリ)と本番 URL
2. 技術スタック(Next.js / Convex / Clerk / Vercel)
3. ローカル開発の始め方(`npm ci`、`npx convex dev`、`npm run dev`、
   必要な環境変数の名前と取得先)
4. 主要コマンド(lint / typecheck / test / build)
5. `docs/` 配下の各ドキュメントへの案内(詳細は README に書かず参照に留める)

## 想定する変更範囲

- `README.md` のみ(1 ファイル)。`max_changed_files: 40` に収まる。

## リスク・見送る理由になりうる点

- 個人開発のプライベートリポジトリであれば、README を整備しても読者は
  将来の自分と AI エージェントだけで、投資対効果が低いと判断する余地がある。
- 環境変数やセットアップ手順を README に書くと、`docs/deployment.md` と
  記載が重複し、変更時に二重メンテが必要になる。README には「名前と参照先」
  だけを書き、手順の正本は docs/ 側に置く運用を崩さないことが前提。
- アプリの説明や URL をどこまで README に書くかは公開範囲の判断を伴う
  (リポジトリを将来 public にする場合、本番 URL の記載は避けたい可能性がある)。
