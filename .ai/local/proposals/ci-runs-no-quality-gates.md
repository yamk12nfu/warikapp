---
schema_version: 1
id: ci-runs-no-quality-gates
status: open
proposed_at_commit: f202a6a8fb8589426bd11c682ce3fce8ce2c204f
sources:
  - path: ".github/workflows/ai-review.yml"
  - path: "vercel.json"
---

## 提案: CI は quality gates（lint / typecheck / test / build）を実行しない、という knowledge entry

タイトル案: 「ai-review CI が検証するのは aro のルールだけ — quality gates はローカルでしか走らない」
（既存 knowledge `ai-review-pipeline.md` への追記が自然）

`.github/workflows/ai-review.yml` はリポジトリ唯一の workflow で、単一の `uses:` で
ai-repo-ops の reusable workflow に委譲するだけであり、**warikapp の依存をインストール
する step も `npm run lint` / `npx tsc --noEmit` / `npm test` / `npm run build` を実行する
step も存在しない**。reusable workflow 側（@v1）に見える `pnpm install` は aro CLI
エンジン自身のビルド用で、対象 repo の quality gates は実行されない（2026-08-09 に
ai-repo-ops のローカル checkout で確認）。

非自明な点: 「CI が緑 = lint / test が通った」は誤りで、PR 上の自動チェックは
aro guard / proposals check / knowledge check のみ。quality gates が自動実行されるのは
AI improve ループのローカル自己検証だけで、`npm run build` に限っては merge 後に
Vercel の本番デプロイ（`vercel.json` の `buildCommand`）で初めて走る。つまり
**テストや lint が赤いままの PR も CI では検出されず merge できてしまう**。
accepted 提案 `quality-gates-add-test` は「quality gate に入れれば CI でテストが必ず
実行される」と書いているが、この前提は成立していないため、清書時にはその提案の
効果範囲（ローカルループのみ）の訂正としても価値がある。
