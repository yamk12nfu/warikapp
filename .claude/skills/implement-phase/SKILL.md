---
name: implement-phase
description: warikapp実装計画書のPhaseを定型フロー(mainからブランチ作成→計画書どおり実装→検証→PR作成)で実装する。使い方: /implement-phase 3 のようにフェーズ番号を渡す。マージは行わない。
disable-model-invocation: true
---

# Implement Phase

実装計画書のPhase $ARGUMENTS を、以下の定型フローで実装する。

## 前提

- 正本は `docs/requirements.md`(仕様)と `docs/implementation-plan.md`(手順)。まず該当Phaseの節を読む
- `convex/` 配下のコードを書く場合は、先に `convex/_generated/ai/guidelines.md` を読む
- `git status` がcleanであることを確認。未コミットの変更があればユーザーに確認する

## フロー

1. **ブランチ作成**: `git checkout main && git pull` → `git checkout -b feature/phase-<番号>-<内容の短い英語slug>`
2. **実装**: 計画書のタスクを上から順に実装する。計画書と実装が食い違ったら計画書側を更新して同期を保つ(implementation-plan.html のラベルも対象。ただし input の id 属性は変更しない)
3. **検証**(すべて通過するまで次へ進まない):
   - `npx tsc --noEmit`
   - `npm run lint`
   - `convex/` に変更がある場合: `npx convex dev --once`
   - 計画書「✅ 動作確認」のうち自動確認できる項目(curl・CLI等)
4. **コミット**: 意味のある単位でコミット(メッセージ先頭: `Phase <番号>: <要約>`)
5. **PR作成**: push → `gh pr create`。PR本文に「実装内容 / 実施した検証 / ユーザーに残る手動確認チェックリスト(計画書の✅動作確認からブラウザ操作が必要なもの)」を記載

## 禁止事項

- mainへの直接コミット
- PRの自動マージ(マージはユーザーの判断)
- 計画書にないスコープの追加実装(必要だと気づいた場合は提案として報告する)

## 報告

最後に必ず報告する: PR URL / 実施した検証の結果 / ユーザーが手動で行う動作確認項目のリスト
