# 固定費

`/fixed-costs` で家賃などのテンプレートを登録し、当月分を支出として計上する。登録中のテンプレートは編集・停止でき、詳細では月ごとの計上履歴を確認できる。

## Sub-features

- `fixed-cost-list` 稼働中/停止済みを分け、当月の計上状態を表示する。
- `fixed-cost-create` 名目・金額・支払者・負担区分・分類と開始月を指定して登録する。
- `fixed-cost-post` 今月分から登録すると `purchasedAt` が月初の確定済み支出をすぐ作る。来月分からなら今月は開始前になる。
- `fixed-cost-update` テンプレートを更新しても計上済み支出は変わらない。
- `fixed-cost-stop` 停止を確認し、これからの計上を止める。退出したパートナーが負担区分に含まれていれば自動停止する。
- `fixed-cost-history` 月ごとの支出へ移動でき、削除済み月は「削除済み(再計上しません)」と表示する。
- `fixed-cost-expense-link` ホームと支出詳細に固定費バッジを出し、詳細からテンプレートへ移動する。

## How to get to it (user POV)

- ヘッダーのメニューから「固定費」(`/fixed-costs`)。
- 固定費一覧の「固定費を追加」から登録画面(`/fixed-costs/new`)。
- 固定費一覧のテンプレート行から詳細(`/fixed-costs/<id>`)。
- ホームの支出一覧にある「固定費」バッジから支出詳細へ進み、「固定費・<月>分」リンクでテンプレート詳細へ戻る。
- URL 直打ち `http://localhost:3100/fixed-costs`、`/fixed-costs/new`、`/fixed-costs/<id>`。

## Driving it with playwright-cli

Preconditions:

- `V=.claude/skills/verify-warikapp/scripts/verify.sh` として `$V launch` → `$V doctor` 全 PASS → `$V login` を済ませる。
- ログイン後は検証ユーザーの世帯にいる。パートナー未参加でも登録できる。
- `MARK="検証$(date +%H%M%S)"` を決め、`E=$($V evidence fixed-costs)` に証跡を保存する。

- **一覧を開く。** `$V pw goto http://localhost:3100/fixed-costs`。見出し「固定費」、登録中/停止済みのセクション、「固定費を追加」リンクが表示される。`$V pw --raw snapshot > "$E/01-list.yml"`。
- **今月分を登録する。** `$V pw click "getByRole('link', { name: /固定費を追加/ })"`。`$V pw fill "#fixed-cost-name" "$MARK 家賃"` → `$V pw fill "#fixed-cost-amount" "50000"` → `$V pw click "getByLabel('今月分から')"` → `$V pw click "getByRole('button', { name: 'この固定費を登録する' })"`。5秒後、一覧に `$MARK 家賃` と「計上済み」が出る。`$V pw screenshot --filename="$E/02-created.png"`。
- **DB とホームのバッジを確認する。** `npx convex data fixedCosts --limit 10 --order desc | tee "$E/03-db-fixedCosts.txt" | grep -F "$MARK"` と `npx convex data expenses --limit 10 --order desc | tee "$E/04-db-expenses.txt" | grep -F "$MARK"`。固定費行の `startMonth` と、支出行の `fixedCost.id` / `fixedCost.month` / `source: "manual"` / `status: "confirmed"` / 月初の `purchasedAt` を確認する。`$V pw goto http://localhost:3100/` → `$V pw click "getByRole('button', { name: 'すべて' })"`。`$MARK 家賃` が見つからない場合は「もっと読み込む」を押し、支出行と「固定費」バッジを確認する。`$V pw --raw snapshot > "$E/05-home.yml"` → `$V pw screenshot --filename="$E/06-home.png"`。
- **支出詳細からテンプレートへ移動する。** `$V pw click "getByRole('link', { name: /$MARK 家賃/ })"`。詳細に「固定費・<月>分」リンクがあり、`$V pw click "getByRole('link', { name: /固定費の/ })"` で `/fixed-costs/<id>` に移る。`$V pw --raw snapshot > "$E/07-detail.yml"` → `$V pw screenshot --filename="$E/08-detail.png"`。
- **テンプレートを編集する。** 詳細の `#fixed-cost-amount` を `51000` にして `$V pw click "getByRole('button', { name: '変更を保存する' })"`。テンプレート金額は `51000` になるが、当月の支出金額は `50000` のまま。画面と DB の支出行を両方確認する。
- **来月分のみを作り、停止する。** 一覧に戻り「固定費を追加」から別のマーカー名 `"$MARK 来月会費"` と金額 `3000` を入力する。`$V pw click "getByLabel('来月分から')"` を選んで登録する。一覧は「開始前」で当月の `expenses` 行はない。詳細で `$V pw click "getByRole('button', { name: 'この固定費を停止' })"` → `$V pw click "getByRole('button', { name: '停止する' })"` と進み、一覧の停止済みセクションに「停止」と表示される。
- **削除済み月を再計上しない。** `$MARK 家賃` の固定費詳細から履歴の「支出を見る」を開き、支出詳細で `$V pw click "getByRole('button', { name: '削除' })"` → `$V pw dialog-accept`。固定費詳細へ戻りテンプレート金額を `52000` にして「変更を保存する」。一覧は「削除済み」のまま、`npx convex data expenses --limit 10 --order desc | grep -F "$MARK 家賃"` に同じ `fixedCost.id` / `fixedCost.month` の行が1件だけあり `deletedAt` が付いている。
- **Proof。** `$E` に各画面の snapshot / screenshot、`03-db-fixedCosts.txt`、`04-db-expenses.txt`、`marker.txt` と、使用した入口・feature ID を記した `README.txt` を残す。

## Gotchas

- 計上支出の購入日は月初なので、ホームで見つからない場合は「すべて」と追加読み込みを使う。
- 今月分からの登録はすぐ支出を作る。すでに手入力した月なら「来月分から」を使う。
- 支出行を削除してもその月の印は残る。テンプレートの保存や日次 cron で復元されない。
- 退出に伴う自動停止は shares または支払者のメンバー参照を使う。未退出の検証世帯だけではこの経路を画面から再現できない。
- cron は当月分だけを毎日試す。月末まで失敗した月は自動補完されず、一覧の「未計上」を確認して手入力する。
