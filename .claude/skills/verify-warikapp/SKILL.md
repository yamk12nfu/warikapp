---
name: verify-warikapp
description: warikapp(同棲カップル向け割り勘Web UI / Next.js 16 + Convex + Clerk)を実際に起動し、検証用ユーザーでログインして機能をユーザー操作で動かし、証跡(スナップショット・スクリーンショット・Convexの行)を残す。変更が「本当に動く」ことを証明したいとき、レビューやPR前の動作確認、features/ にある機能の再検証に使う。ユニットテスト(vitest)の代わりではない。
---

# verify-warikapp

warikapp は Web UI が唯一のユーザー接面(ほかに `/mcp` のリモートMCPサーバーがあるが、Bearer認証が要るためこのスキルの対象外)。ここに書いた手順は Next dev サーバー + Convex **dev デプロイメント** + Clerk **開発インスタンス** に対して動く。本番(`.env.prod`)には絶対に向けない。

全操作は `.claude/skills/verify-warikapp/scripts/verify.sh` 経由で行う。以下 `V=.claude/skills/verify-warikapp/scripts/verify.sh` と略記。

## Launch

```bash
V=.claude/skills/verify-warikapp/scripts/verify.sh
$V launch          # npx convex dev --once で関数を push → next dev を port 3100 で起動
```

- 準備完了の合図: `ready: http://localhost:3100 (pid N)` が出る(`/login` が 200 を返した時点)。
- port 3100 が別プロセスに使われていたら起動を拒否する(exit 3)。その場合は `VERIFY_PORT=3101 $V launch` のように別 port を使う。ユーザーが `npm run dev` で動かしている 3000 には一切触らない。
- 起動した pid は `.verify-run/next.pid` に、ログは `.verify-run/next-dev.log` / `convex-push.log` に残る。
- Convex の関数は `convex dev --once` で dev デプロイメントに push される。`convex/` を変更したら再度 `$V launch`(起動済みなら一度 `$V cleanup`)。
- 前提: `.env.local` に `CONVEX_DEPLOYMENT=dev:…`、`NEXT_PUBLIC_CONVEX_URL`、Clerk の `pk_test_` / `sk_test_` キーがあること(README「ローカル開発」のとおり)。

## Doctor

```bash
$V doctor
```

読み取り専用。次を PASS/FAIL で出す: この run が起動した next dev が生きている / port 3100 の所有者がその pid ツリー / `/login` が 200 / 未ログインの `/settlement` がリダイレクト / Clerk キーが `sk_test_` / Convex が `dev:` / playwright-cli の解決先 / ブラウザセッション `verify` の有無。何かおかしいと感じたら、まずこれを走らせる。FAIL があるインスタンスは操作しない。

## Drive

ハーネスは `playwright-cli`(セッション名 `verify`)。`$V pw <playwright-cli の引数>` で呼ぶ。`playwright-cli` の shim は mise の node 22 でしか解決しないため、`verify.sh` が `~/.local/share/mise/installs/node/22*/bin/playwright-cli` を自動で探す(手動指定は `PLAYWRIGHT_CLI=`)。

**ログイン(必須の最初の一手):**

```bash
$V login
```

- ログイン画面は Google OAuth しか出さないので、UI からは入れない。`scripts/clerk-login-url.mjs` が Clerk Backend API で検証専用ユーザー(external_id `warikapp-verify-agent`、username `warikapp_verify_agent`、メールなし)を冪等に用意し、5分有効のサインイントークン付き URL `/login?__clerk_ticket=…` を作る。`login` はそれをブラウザで開く。
- 初回は世帯未所属で `/setup` に着くので、`login` が表示名「検証エージェント」で世帯を自動作成してホームへ移る。2回目以降は `/` に直接着く。
- 検証ユーザーの世帯は、開発者自身の Google アカウントの世帯とは別テナント。データは Convex dev デプロイメントに実際に書かれるが、他の世帯からは見えない(認可モデルは world = couple 単位)。
- パートナー側の操作(招待コードで参加、精算の相手側表示)は 2 人目のユーザーが要る。`WARIKAPP_VERIFY_EXTERNAL_ID=warikapp-verify-partner $V login` のように external_id を変えると 2 人目を作れるが、ブラウザセッションは 1 つなので、1 人目で `state-save` してから切り替えること(features/setup-household.md 参照)。

**操作の基本形:**

```bash
$V pw goto http://localhost:3100/expenses/new/manual
$V pw --raw snapshot                                   # ARIA スナップショット(ref 取得)
$V pw fill "#store-name" "スーパーやまだ"
$V pw fill "getByLabel('品目名')" "牛乳"
$V pw fill "getByLabel('金額')" "250"
$V pw click "getByRole('button', { name: 'この支出を登録する' })"
$V pw --raw eval "location.pathname"
```

- 安定したハンドルを使う: `getByRole` / `getByLabel` / `#store-name` `#purchased-at` `#paid-by` `#expense-category` `#display-name` `#memo` のような id、`aria-label`(`品目名`、`金額`、`負担区分: 折半` など)。座標や ref 番号の決め打ちは避ける(ref は snapshot ごとに変わる)。
- 画面遷移後は 3〜5 秒待ってから snapshot する(Clerk 初期化 + Convex 購読の反映に時間がかかる)。
- `window.confirm` を出す操作(支出削除、精算取り消し)は `$V pw dialog-accept` を続けて呼ぶ。
- 機能ごとの具体手順は `features/` を見る。

## Evidence

```bash
E=$($V evidence manual-expense)     # 例: .verify-evidence/20260922T231500-manual-expense
$V pw --raw snapshot > $E/01-form.yml
$V pw screenshot --filename=$E/02-filled.png
```

- 置き場所: リポジトリ直下 `.verify-evidence/<timestamp>-<feature>/`(gitignore 済み。cleanup では消さない)。
- 証拠の基準:
  1. **実際のユーザー経路**で動かす(Convex の mutation を直接叩いて状態を作らない。`npx convex run` は確認用の読み取りにだけ使う)。
  2. **操作前・操作直後・結果画面**を取る。最終画面だけでは不十分。
  3. **副作用**も確認する。UI の表示に加えて `npx convex data expenses --limit 3 --order desc` などでテーブルの行を見る(dev デプロイメントの管理読み取り。他世帯の行も見えるので、検証で使った一意なマーカー文字列で grep する)。
  4. 一意マーカー: 店名や品目名に `検証<HHMMSS>` を含め、一覧・DB での照合はそれで行う。
  5. モックは使わない。レシートAI(Gemini)だけは外部境界なので、`RECEIPT_AI_PROVIDER` を切り替えた結果を観測する形で扱う(features/receipt-expense.md)。
- 各証跡ディレクトリに `marker.txt`(使ったマーカー)と、どの feature ID・どの入口を使ったかを書いた `README.txt` を残す。

## Cleanup

```bash
$V cleanup
```

- ブラウザセッション `verify` を閉じ、`.verify-run/next.pid` の pid(とその子)だけを止める。プロセス名で kill しない。`.verify-run/` を消す。
- `.verify-evidence/` は残す。
- 検証ユーザーが作った支出・精算は Convex dev に残る。増えすぎたら UI(支出詳細 → 削除、精算 → 取り消し)から消す。ユーザーのアカウントも Clerk 開発インスタンスに残る(消す必要はない)。
- 失敗した試行の後も必ず `$V cleanup` を呼ぶ(port と pid を残さない)。

## Helpers

| ファイル | 役割 | 呼び方 |
|---|---|---|
| `scripts/verify.sh` | launch / doctor / login / pw / evidence / cleanup | 上記 |
| `scripts/clerk-login-url.mjs` | 検証ユーザーの用意とサインイン URL の発行(`sk_test_` 以外は拒否) | `node .claude/skills/verify-warikapp/scripts/clerk-login-url.mjs [origin]` |

## 制約

- 同時に 2 run は動かせるが(`VERIFY_PORT` を変える)、ブラウザセッション名は `verify` 固定なので 1 run ずつ。
- Convex dev デプロイメントは開発者と共用。スキーマ変更を含むブランチでは `convex dev --once` の push が開発者側のデータに影響しうる。その場合は先にユーザーへ伝える。
- 本番 URL(warikapp.yamk12nfu.com)は対象外。
