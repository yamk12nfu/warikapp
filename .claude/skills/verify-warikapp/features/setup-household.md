# 世帯のセットアップ

ログイン直後に世帯がなければ `/setup` に誘導され、世帯を作るか招待コードで参加する。作成側には招待コードと招待 URL が出て、設定画面からいつでも確認・再発行できる。

## Sub-features

- `setup-redirect` 世帯未所属のユーザーは保護ページを開くと `/setup` に着く。
- `setup-create` 表示名(1〜20文字)と任意の世帯名で世帯を作り、招待コードが表示される。
- `setup-join` 招待コード(または `/setup?code=XXXXXXXX`)で 2 人目が参加する。
- `settings-name` 設定画面で表示名を変更して保存できる。
- `settings-invite` 設定画面で招待コードを発行・再発行できる(パートナー未参加のときだけ)。
- `logout` 設定画面の「ログアウト」で `/login` に戻る。

## How to get to it (user POV)

- 初回ログイン後の自動遷移(`/setup`)。
- 招待 URL `http://localhost:3100/setup?code=<コード>` を開く(参加タブが初期選択になる)。
- ヘッダーのメニュー(`メニューを開く` ボタン)→ 設定、またはホーム下部の「設定」リンク → `/settings`。

## Driving it with playwright-cli

Preconditions:

- `$V launch` と `$V doctor` が通っている。
- `setup-create` は世帯未所属のユーザーでしか見られない。既定の検証ユーザーは初回 `$V login` で世帯を作ってしまうので、この経路を検証するときは新しい external_id を使う: `WARIKAPP_VERIFY_EXTERNAL_ID=warikapp-verify-$(date +%s) $V login`(`login` が自動で世帯作成まで進めるので、途中の画面を取りたいときは `node .claude/skills/verify-warikapp/scripts/clerk-login-url.mjs` で URL だけ取り、`$V pw goto <url>` で手動で進める)。

- **未所属の着地。** 新しい external_id のログイン URL を `$V pw goto "<url>"` で開く。5 秒後 `$V pw --raw eval "location.pathname"` が `"/setup"`、見出し `世帯のセットアップ` と `世帯を作る` / `招待コードで参加` の 2 ボタンが snapshot に出る。
- **世帯を作る。** `$V pw fill "getByRole('textbox', { name: 'あなたの表示名' })" "検証エージェント"` → `$V pw click "getByRole('button', { name: '世帯を作成する' })"`。3 秒後、見出しが `世帯を作成しました` になり、`招待コード` の下に 8 文字の英数字、`有効期限: …`、`コードをコピー` / `招待URLをコピー`、`http://localhost:3100/setup?code=<コード>` が出る。コードを控える。
- **DB 確認。** `npx convex data couples --limit 3 --order desc` と `npx convex data invitations --limit 3 --order desc` に新しい行がある(招待の `code` が画面と一致)。
- **参加(2 人目)。** 1 人目の状態を `$V pw state-save .verify-run/user-a.json` で退避。`WARIKAPP_VERIFY_EXTERNAL_ID=warikapp-verify-partner node .claude/skills/verify-warikapp/scripts/clerk-login-url.mjs` で 2 人目の URL を取り、`$V pw cookie-clear` → `$V pw goto "<url>"`。`/setup` で `$V pw click "getByRole('button', { name: '招待コードで参加' })"`、表示名とコードを埋めて `参加する` 系のボタンを押す(正確なラベルは snapshot で確認)。3 秒後 `/` に遷移し、ホームに 2 人の名前が出る。
- **表示名の変更。** `$V pw goto http://localhost:3100/settings` → `$V pw fill "#display-name" "検証エージェント2"` → `$V pw click "getByRole('button', { name: '表示名を保存' })"`。`保存しました` が出る。`$V pw reload` 後も新しい名前が入っている。
- **招待コードの再発行。** `/settings` の `パートナー` 節で `$V pw click "getByRole('button', { name: '招待コードを再発行' })"`(未発行なら `招待コードを発行`)。コードが変わり、`npx convex data invitations --limit 1 --order desc` の `code` が一致する。
- **ログアウト。** `/settings` 最下部の `アカウント` 節で `$V pw click "getByRole('button', { name: 'ログアウト' })"`。`/login` に戻り、`$V pw goto http://localhost:3100/` が再び `/login` に飛ぶ。
- **Proof。** `E=$($V evidence setup-household)` を作り、着地・作成完了・設定画面それぞれの `--raw snapshot > $E/NN-*.yml` と `screenshot --filename=$E/NN-*.png`、DB 出力を `$E/db-*.txt` に残す。

## Gotchas

- 既定の検証ユーザー(`warikapp-verify-agent`)はすでに世帯を持っている。`setup-create` の再検証には必ず別の external_id を使う。使い捨てユーザーは Clerk 開発インスタンスに残るので、名前に日付を入れて見分けられるようにする。
- 招待コードは 3 日で期限切れ。期限切れコードでの参加はエラー表示になるのが正常。
- 世帯作成直後の画面は `stayOnPage` で留まる。`ホームへ` リンクを押すまで `/` に遷移しない。
- ブラウザセッションは 1 つ。2 人目を操作したら、1 人目に戻るときは `$V pw state-load .verify-run/user-a.json`。
- ログアウト検証の後は `$V login` をやり直す(サインイントークンは 5 分で失効するので毎回発行される)。
