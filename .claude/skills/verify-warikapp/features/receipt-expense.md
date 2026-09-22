# レシートからの支出登録

`/expenses/new/receipt` でレシート画像を選ぶと、Convex の action が外部 AI(既定 Gemini、環境変数で Claude)で品目に分解し、下書き(draft)として保存する。ユーザーは品目・金額・負担区分を直して `この支出を確定する` で確定する。

## Sub-features

- `receipt-upload` `レシートを撮影・選択` から画像を選ぶとアップロードが始まり、進行状態が表示される。
- `receipt-parse` AI 読み取りの結果が品目行として ExpenseEditor に入る。
- `receipt-confirm` 内容を直して確定すると `status` が `confirmed` になりホームに出る。
- `receipt-retry` アップロード失敗時に `もう一度アップロードする` で再試行できる。
- `receipt-draft-list` 未確定の下書きはホームで下書きとして見え、精算の対象外。

## How to get to it (user POV)

- ホーム(`/`)の `レシートから登録`(主ボタン)。
- URL 直打ち `http://localhost:3100/expenses/new/receipt`。

## Driving it with playwright-cli

Preconditions:

- `$V login` 済み。
- Convex dev デプロイメントに `GEMINI_API_KEY`(または `RECEIPT_AI_PROVIDER=claude` + `ANTHROPIC_API_KEY`)が設定されている: `npx convex env list` で確認。未設定なら `receipt-parse` は到達不能として報告する(前提条件未達)。
- レシート画像(JPEG/PNG)を `.verify-run/receipt.jpg` に用意する。リポジトリに同梱の画像はないので、`$V pw screenshot --filename=.verify-run/receipt.png` で撮った画面でも「読み取れないレシート」のエラー経路の検証には使える。実レシートの読み取りは人間が写真を置いたときだけ検証できる。

- **画面を開く。** `$V pw goto http://localhost:3100/expenses/new/receipt`。見出し `レシートから登録`、`receipt-image` の file 入力(`accept="image/*"`)がある。
- **画像を選ぶ。** `$V pw upload .verify-run/receipt.jpg`(直前に file 入力をクリックしてファイルチューザーを開くか、`$V pw run-code "async page => await page.setInputFiles('#receipt-image', '.verify-run/receipt.jpg')"`)。アップロード中の表示 → AI 読み取り中の表示 → 品目行が出る。読み取れない画像ならエラー文言と `もう一度アップロードする`。
- **副作用(外部境界)。** `npx convex logs --limit 50` に `receipts:parse` の実行が出る。`npx convex data uploads --limit 1 --order desc` に新しい行。これで「実際に外部 AI を呼んだ」ことを確認する。モックしない。
- **確定する。** 品目名・金額を必要なら直して `$V pw click "getByRole('button', { name: 'この支出を確定する' })"`。`/` に戻り、一覧に店名(AI の抽出結果)が出る。`npx convex data expenses --limit 1 --order desc` の `status` が `confirmed`、`receiptStorageId`(または相当)が入っている。
- **Proof。** `E=$($V evidence receipt-expense)`。アップロード前・読み取り結果・確定後ホームの snapshot と screenshot、`convex logs` と `convex data` の出力。

## Gotchas

- 外部 AI は実費がかかり、数秒〜十数秒待つ。snapshot は結果が出るまで数回取り直す(固定 sleep で決めつけない)。
- `GEMINI_API_KEY` は Convex 側の env であって `.env.local` ではない。`npx convex env list` で見る。
- 下書き(draft)が残っていると精算画面に `確定または削除してから精算してください` の警告が出て精算できない。レシート検証の後は確定するか、詳細画面から削除する。
- 画像の検証にレシート以外を渡すと AI が空の品目を返すことがある。それは「エラー経路」の検証であって、読み取り成功の証拠にはならない。
