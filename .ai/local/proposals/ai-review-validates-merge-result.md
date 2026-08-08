---
schema_version: 1
id: ai-review-validates-merge-result
status: done
proposed_at_commit: 5bceda961cc50ac0944c4684d79f0004dc9dbea0
sources:
  - path: ".github/workflows/ai-review.yml"
decision:
  by: yamk12nfu
---

## 提案: ai-review CI は「main とのマージ結果」を検証する、という knowledge entry

タイトル案: 「ai-review: 検証対象はローカル HEAD ではなく PR と main のマージ結果」

`.github/workflows/ai-review.yml` は `on: pull_request` で発火するため、guard /
proposals check は PR ブランチそのものではなく **GitHub が作る merge ref
（PR を最新 main にマージした状態）** に対して実行される。同ファイルのコメントにも
「並行 PR の merge で混入した重複を、merge 後の状態に対する検証で決定的に検出する」
という設計意図が明記されている。

非自明な点: ローカルの `aro guard` / `aro proposals check --strict` は自ブランチの
HEAD を検証するため、**ローカル main が origin より遅れていると、ローカルで全て
PASS しても CI だけが fail する**（実例: PR #34。3日遅れの main 上で作った提案が、
マージ結果では source 変更済みとなり strict の `source.stale` で fail）。
この repo は main 直コミット禁止・GitHub 上マージ運用のため、ローカル main は
マージ後に自動では進まず、この乖離が起きやすい。aro 系の作業（propose / improve /
knowledge-refresh）の開始前に origin/main と同期することが実務上の前提になる。
