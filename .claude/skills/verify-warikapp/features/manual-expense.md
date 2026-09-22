# 支出の手入力

`/expenses/new/manual` で店名・購入日・支払者・分類・品目(名前・金額・負担区分)を入れて登録する。登録後はホームの「支出」一覧に現れ、未精算差額に反映される。

## Sub-features

- `manual-open` ホームの `手入力` ボタンからフォームが開き、支払者が自分、購入日が今日、品目 1 行が初期表示される。
- `manual-save` 店名と品目 1 行以上で `この支出を登録する` が有効になり、登録後 `/` に戻る。
- `manual-share` 品目ごとの負担区分(折半 / 自分 / 相手 / カスタム割合)で `立て替え額` が変わる。
- `manual-items` 品目の追加・削除ができる。
- `manual-validate` 金額 0 や品目名空は `role="alert"` のエラーになり登録できない。

## How to get to it (user POV)

- ホーム(`/`)の `手入力` リンク。
- `/expenses/new/receipt` の下部にある「手入力に切り替える」系のリンク(`/expenses/new/manual`)。
- URL 直打ち `http://localhost:3100/expenses/new/manual`。

## Driving it with playwright-cli

Preconditions:

- `$V login` 済みで `/` にいる(世帯あり)。
- `MARK="検証$(date +%H%M%S)"` を決めてある。

- **フォームを開く。** `$V pw goto http://localhost:3100/expenses/new/manual`。5 秒後、見出し `支出を手入力`、`#store-name`、`#purchased-at`(今日の日付)、`#paid-by`(自分が選択)、`#expense-category`、`品目名` と `金額` のテキストボックス、無効な `この支出を登録する` ボタンが snapshot に出る。`$V pw --raw snapshot > $E/01-form.yml`。
- **入力する。** `$V pw fill "#store-name" "$MARK ストア"` → `$V pw fill "getByLabel('品目名')" "$MARK 牛乳"` → `$V pw fill "getByLabel('金額')" "250"`。`合計` が `¥250`、`立て替え額` が `¥125`(折半)になり、登録ボタンが有効になる。`$V pw screenshot --filename=$E/02-filled.png`。
- **負担区分を変える(任意)。** `$V pw click "getByRole('button', { name: '負担区分: 折半' })"` で区分が循環し(折半 → 自分 → 相手 → …)、`立て替え額` が追従する。`カスタム割合を入力` ボタンで割合欄が出る。
- **登録する。** `$V pw click "getByRole('button', { name: 'この支出を登録する' })"`。5 秒後 `$V pw --raw eval "location.pathname"` が `"/"`。
- **一覧で確認。** `$V pw --raw snapshot > $E/03-home.yml` に `link "$MARK ストア … 検証エージェント(あなた)が支払い ¥250"` がある。`未精算差額` はパートナー参加済みの世帯でだけ動く(1 人の世帯では `¥0` / `貸し借りはありません` のまま。これは仕様)。`$V pw screenshot --filename=$E/04-home.png`。
- **DB 確認。** `npx convex data expenses --limit 3 --order desc | tee $E/05-db-expenses.txt | grep -c "$MARK"` が `1` 以上。行の `storeName` がマーカー付き店名、`items[0].amount` が 250。
- **Proof。** `$E` に `marker.txt`(`$MARK`)と `README.txt`(feature `manual-save`、入口 = URL 直打ち)を書く。

## Gotchas

- 登録ボタンは店名か品目が空だと無効のまま。押せない場合は先に snapshot で `disabled` を確認する。
- ref 番号(`e75` など)は snapshot ごとに変わる。`getByLabel` / `getByRole` を使う。
- `npx convex data expenses` は世帯をまたいで全行を返す。マーカーで grep しないと他世帯の行を証拠にしてしまう。
- 購入日は JST の今日。日付境界(23:00〜翌 9:00 UTC)に走らせると日付の期待値がずれる。
- 1 人だけの世帯では未精算差額が常に `¥0`。差額の検証は setup-household.md でパートナーを参加させてから。
- ホームの一覧は既定で `未精算のみ` フィルタ。精算済みにした支出を探すときは `表示する支出` グループの `すべて` を押す。
