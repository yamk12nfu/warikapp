# warikapp 本番デプロイ手順書(Phase 9)

計画書 `docs/implementation-plan.md` §11 の作業を、**ダッシュボードで実際に押す順**に開いたもの。
上から順にやれば通る。詰まったら最後の §7「症状 → 原因」を見る。

コードとリポジトリ側の準備は済んでいる(`vercel.json` を含む)。ここに書いてあるのは
**外部サービスのダッシュボードでの作業だけ**で、すべて人間の手作業。

---

## 0. 始める前に

### 現在地

| 項目 | 状態 |
|---|---|
| Convex 本番デプロイ | `accurate-capybara-527` が作成済み。**テーブル0件・環境変数0件**(まだ何も入っていない) |
| Convex 開発デプロイ | `benevolent-koala-496`。`CLERK_JWT_ISSUER_DOMAIN` と `GEMINI_API_KEY` を登録済み |
| Clerk | 開発インスタンスのみ(共有Google認証を利用中) |
| Vercel | 未Import |

### ⚠️ 先に決めること: ドメインを持っているか

**Clerkの本番インスタンスは、自分が所有するドメインが必須**。Clerkのダッシュボードが指示する
CNAMEレコードを自分で追加する必要があるため、`*.vercel.app` のような借り物のドメインでは作れない。

- **ドメインを持っている(または取得する)** → §1 からそのまま進む(計画書どおりの本線)
- **ドメインを用意しない** → §1 を飛ばして **§1-alt** を読む。開発インスタンスのまま公開する

ドメインを取るなら年1,000〜2,000円程度。取得直後でも使える(DNSの反映に最大48時間かかると
Clerkは案内しているが、実際は数分〜数時間で通ることが多い)。

### 用意するもの

- Googleアカウント(Google Cloud Console と Google AI Studio 用)
- Clerk / Vercel のアカウント
- ドメイン(上記のとおり。§1-alt を選ぶなら不要)

### 所要時間の目安

DNSの反映待ちを除いて 1〜1.5時間。DNSを待つ場合はそこで一度中断できる(§1 まで進めて放置 → 翌日 §2 から再開)。

---

## 1. Clerk 本番インスタンス + Google OAuth

**ここの設定漏れが本番ログイン失敗のほぼすべて。** 順番どおりにやること
(ClerkでリダイレクトURIを表示 → Googleで登録 → Clerkに貼り戻す、という往復になる)。

### 1-1. 本番インスタンスを作る

1. [Clerk Dashboard](https://dashboard.clerk.com) を開く
2. 左上のインスタンス切替(`Development` と出ているところ)→ **Create production instance**
3. 「開発インスタンスの設定をコピーするか」を聞かれたらコピーする(**ただしソーシャル認証の
   認証情報はコピーされない**。共有のものは本番では使えないため。これが 1-3 の作業になる)

### 1-2. ドメインとDNS

1. Clerk Dashboard → **Domains**
2. 使うドメイン(例: `warikapp.example.com`)を入力
3. 表示されるCNAMEレコード(5件前後。`clerk`, `accounts`, `clkmail`, `clk._domainkey` など)を
   **画面に出ているとおりに**ドメインのDNS設定に追加する
4. Clerkの画面でレコードが緑になるまで待つ

> ⚠️ Cloudflare をDNSに使っている場合、**プロキシ(オレンジの雲)はOFF**にする。ONだとClerkの
> 検証が通らない。

### 1-3. Google Cloud Console で OAuth クライアントを作る

まず **Clerk 側でリダイレクトURIを表示させる**:

1. Clerk Dashboard(本番インスタンス)→ **SSO Connections** → **Google**
2. **Use custom credentials** をONにする
3. 表示される **Authorized Redirect URI**(`https://clerk.<あなたのドメイン>/v1/oauth_callback` の形)を
   コピーしておく。この画面は開いたままにする

次に [Google Cloud Console](https://console.cloud.google.com):

1. プロジェクトを作る(名前は何でもよい。例: `warikapp`)
2. **APIとサービス → OAuth同意画面**
   - User Type: **外部(External)**
   - アプリ名 / ユーザーサポートメール / デベロッパーの連絡先情報 を入力
   - スコープ: `openid` / `userinfo.email` / `userinfo.profile` の3つで足りる
   - ⚠️ **公開ステータス**: 「テスト」のままだと**テストユーザーに登録したGoogleアカウントしか
     ログインできない**。2人ぶんのアカウントをテストユーザーに登録するか、「公開」にする。
     ここが「自分は入れるのにパートナーが入れない」の原因になる
3. **APIとサービス → 認証情報 → 認証情報を作成 → OAuth クライアント ID**
   - アプリケーションの種類: **ウェブアプリケーション**
   - **承認済みのリダイレクト URI**: 上でコピーしたClerkのURIを貼る
     - ⚠️ 末尾スラッシュの有無・大文字小文字の違いでも一致しない。**貼り付けるだけで手打ちしない**
     - 「承認済みの JavaScript 生成元」は空でよい(リダイレクトを受けるのはClerk)
   - 作成 → **クライアントID** と **クライアントシークレット** をコピー

Clerkに戻る:

4. 1-3 の Google の画面に **Client ID** と **Client Secret** を貼って保存

### 1-4. JWTテンプレート `convex` を作る

1. Clerk Dashboard(本番インスタンス)→ **Configure** → **JWT Templates** → **New template** → **Convex**
2. ⚠️ **テンプレート名は `convex`(小文字)のまま変えない**。`convex/auth.config.ts` の
   `applicationID: "convex"` と一致している必要がある
3. 保存し、**Issuer URL**(`https://clerk.<あなたのドメイン>` の形)をコピー → §2 で使う

### 1-5. 本番APIキーを控える

Clerk Dashboard → **API Keys** → `pk_live_...`(Publishable key)と `sk_live_...`(Secret key)を
コピー → §3 で使う。

---

## 1-alt. ドメインを用意しない場合(開発インスタンスのまま公開)

Clerkの**開発インスタンスは本番URLからでも動く**。§1 の代わりにこれで進めてもよい。

- 使うキーは今の `pk_test_...` / `sk_test_...`(`.env.local` にあるもの)
- Issuer URL も今 Convex の dev に入れているもの(`npx convex env get CLERK_JWT_ISSUER_DOMAIN` で確認できる)
- Google OAuth の自前設定は不要(Clerkの共有認証がそのまま使える)

代わりに次を受け入れることになる:

| 制約 | 中身 |
|---|---|
| ユーザー数 | 開発インスタンスは上限100ユーザー(2人なら問題にならない) |
| 同意画面 | Googleのログイン画面に Clerk の名前が出る(自分のアプリ名にはならない) |
| セッション | 開発インスタンスのセッションは本番より短命 |
| 本番への移行 | あとからドメインを取って §1 をやり直せる。**そのときユーザーは作り直しになる** |

> 2人で使うMVPとして割り切るなら 1-alt で十分。**ただし §2 以降では「本番Clerkの値」を
> 「開発Clerkの値」に読み替えること**(Convexのprodには開発ClerkのIssuer URLを入れる)。

---

## 2. Convex 本番環境の環境変数

`accurate-capybara-527`(prod)に登録する。**`.env.local` でもVercelでもない**
— AI呼び出しの action は Convex 側で動くので、Convex に置かないと届かない。

### 必須(2つ)

| 変数 | 値 | 未設定だとどうなるか |
|---|---|---|
| `CLERK_JWT_ISSUER_DOMAIN` | §1-4 の Issuer URL | **デプロイ自体が失敗する**(`convex/auth.config.ts` が読む) |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) のAPIキー | レシート読み取りが「AIの設定が未完了です」で止まる |

### 任意(2つ)

| 変数 | 既定値 | 入れる意味 |
|---|---|---|
| `RECEIPT_AI_PROVIDER` | `gemini` | Claudeに切り替えるとき `claude` にする(要 `ANTHROPIC_API_KEY`) |
| `RECEIPT_AI_MODEL` | `gemini-3.6-flash` | モデルを固定したいとき。コード側の既定が将来変わっても本番の挙動が動かない |

### コマンドでやる場合

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN 'https://clerk.example.com' --prod
```

```bash
npx convex env set GEMINI_API_KEY 'AIza...' --prod
```

登録できたか確認:

```bash
npx convex env list --prod
```

ダッシュボードからやる場合は [Convex Dashboard](https://dashboard.convex.dev/d/accurate-capybara-527) →
右上で **Production** を選択 → **Settings → Environment Variables**。

---

## 3. Vercel

### 3-1. Import

1. [Vercel](https://vercel.com/new) → GitHub の `warikapp` リポジトリを Import
2. Framework Preset は `Next.js` が自動検出される(そのままでよい)
3. ⚠️ **Build Command は触らない**。リポジトリの `vercel.json` に書いてあり、そちらが
   ダッシュボードの設定より優先される:

   ```json
   {
     "buildCommand": "npx convex deploy --cmd 'npm run build'",
     "ignoreCommand": "[ \"$VERCEL_ENV\" != production ]"
   }
   ```

   - `buildCommand`: Convex関数とフロントを**同時に**デプロイする。ダッシュボードにだけ書くと
     設定がリポジトリに残らず、プロジェクトを作り直したときに消える。消えると
     「フロントは新しいのに Convex 関数は古い」という気づきにくい壊れ方をする
   - `ignoreCommand`: 本番以外(PRのプレビュー)のビルドを**丸ごと止める**。プレビュービルドが
     本番用のデプロイキーで `npx convex deploy` を走らせて**本番のConvex関数を書き換える**
     事故を、設定ミスがあっても起きないようにするため。プレビュー環境が欲しくなったら
     Convex側でプレビュー用デプロイキーを発行したうえで、この行を消す

### 3-2. 環境変数

Vercel の **Settings → Environment Variables** に3つ。

| 変数 | 値 | Environment |
|---|---|---|
| `CONVEX_DEPLOY_KEY` | Convex Dashboard → **Production** → Settings → **Deploy Keys** → *Generate Production Deploy Key* | ⚠️ **Production だけにチェック** |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_...`(§1-5) | Production |
| `CLERK_SECRET_KEY` | `sk_live_...`(§1-5) | Production |

> ⚠️ Vercelで環境変数を足すと **既定で Production / Preview / Development の3つ全部にチェックが入る**。
> `CONVEX_DEPLOY_KEY` は必ず Production だけに絞る(`ignoreCommand` で二重に防いではいるが、
> 元を断っておく)。

> ⚠️ **`NEXT_PUBLIC_CONVEX_URL` は設定しない**。`npx convex deploy --cmd` がビルド時に
> 本番のURL(`https://accurate-capybara-527.convex.cloud`)を自動で渡す。手で入れると、将来
> デプロイ先を変えたときに古い値が残って「本番なのに開発のデータが見える」状態になる。

### 3-3. Deploy

**Deploy** を押す。ビルドログに `Deploying to https://accurate-capybara-527.convex.cloud` のような
行が出れば Convex 側も一緒に出ている。

### 3-4. デプロイ後にClerkへ本番URLを登録

1. Clerk Dashboard(本番インスタンス)→ **Domains** / **Paths**
2. Vercelが払い出した本番URL(独自ドメインを当てたならそちら)を登録
3. サインイン後のリダイレクト先が `/` になっていることを確認

---

## 4. デプロイ前にローカルで潰せること

外部サービスを触る前にこれを通しておくと、Vercelのビルドログで初めて気づく、を減らせる。

```bash
npx tsc --noEmit && npm run lint && npx vitest run && npm run build
```

```bash
npx convex dev --once
```

`npx convex dev --once` は **開発デプロイ**に対して、本番デプロイと同じことをやる
(型チェック → バンドル → スキーマとインデックスの反映)。ここを通ればコード側の問題は
ほぼ出尽くす。

本番に対して「何が変わるか」だけ見たいときは:

```bash
npx convex deploy --dry-run
```

> ⚠️ このコマンドは **本番を対象にする**。`--dry-run` でも実行途中で
> 「Do you want to push your code to your prod deployment ... now?」と聞かれるので、
> **意図せず押さないこと**。中身を見るだけなら `n` で抜ける。

**本番デプロイで初めて出る失敗は、実質2つしかない**:

1. `CLERK_JWT_ISSUER_DOMAIN` が prod に未登録 → §2 で解決(ローカルからは
   `npx convex env list --prod` で事前に確認できる)
2. 既存の本番データがスキーマに合わない → **今回は起きない**。本番DBはテーブル0件
   (`npx convex data --prod` で確認済み)。データが入ってからスキーマを変えるときは、
   ここが本番だけで落ちる箇所になる

---

## 5. コスト上限とアラート

### Gemini(既定のAIプロバイダ)

計画書の初期版はAnthropicコンソール前提だったが、既定プロバイダが Gemini になったので
**Google AI Studio 側**で設定する。

1. [Google AI Studio](https://aistudio.google.com) → **Spend** ページ
2. **Monthly spend cap** → **Edit spend cap** で、プロジェクトごとの月額上限を設定する
   - プロジェクトの編集者 / オーナー / 管理者の権限が要る
3. 課金を有効にしていない(無料枠のまま)なら、そもそもレート制限で頭打ちになるので
   上限設定は必須ではない。ただし**無料枠で使えるモデルは限られる**ので、
   `gemini-3.6-flash` が 429 で断られるようなら課金を有効にする

> アプリ側にも歯止めがある: 読み取り30回/時/世帯、アップロードURL発行60回/時/世帯
> (`convex/rateLimits.ts`)。連打やスクリプトでの暴走はここで止まる。

Claudeに切り替えている場合は [Anthropic Console](https://console.anthropic.com) の
Limits でワークスペースの月額上限を設定する。

### Convex

[Convex Dashboard](https://dashboard.convex.dev/d/accurate-capybara-527) → **Usage** で、
関数呼び出し数・データベース帯域・**File Storage** を見る。File Storage は
レシート画像が積み上がる場所で、TBD-002(置き去りアップロードの掃除)の判断材料になる
(計画書 §11 参照)。

---

## 6. 動かし始める

1. 本番URLを自分のスマホで開いて Googleログイン → 世帯を作る
2. 設定画面から招待コードを発行してパートナーに渡す
3. パートナーが**別のGoogleアカウント**でログイン → 招待コードで参加

通しの確認項目は `docs/verification-checklist.md` を使う。

---

## 7. 症状 → 原因の早見表

| 症状 | 原因 | 対処 |
|---|---|---|
| Vercelのビルドが `CONVEX_DEPLOY_KEY` 関連で落ちる | キーが未設定、またはEnvironmentがProductionになっていない | §3-2 |
| ビルドは通るが、開いたら画面が真っ白 | `NEXT_PUBLIC_CONVEX_URL` を手で入れて古い値を指している | Vercelから消して再デプロイ(§3-2) |
| Convexのデプロイが auth.config で落ちる | prod に `CLERK_JWT_ISSUER_DOMAIN` が無い | §2 |
| ログイン画面までは出るが Google を押すとエラー | GoogleのOAuthクライアントのリダイレクトURIがClerkのものと一致していない | §1-3。**貼り直す**(手打ちしない) |
| 自分はログインできるがパートナーができない | OAuth同意画面が「テスト」のままで、相手がテストユーザーに入っていない | §1-3 の2 |
| ログインは通るがアプリが「ログインしてください」のまま | ClerkのJWTテンプレート名が `convex` になっていない / prodのIssuer URLが開発インスタンスのもの | §1-4、§2 |
| レシート読み取りが「AIの設定が未完了です」 | prod に `GEMINI_API_KEY` が無い(devにしか入っていない) | §2 |
| レシート読み取りが「AIモデル『…』が使えません」 | `RECEIPT_AI_MODEL` の綴り間違い、またはそのキーで使えないモデル | §2。消せばコード側の既定に戻る |
| レシート読み取りが「AIの利用上限に達したか、残高が不足」 | Gemini側のレート制限か残高切れ | §5 |
| PRを出すとVercelのチェックが「Skipped」になる | `ignoreCommand` の意図どおりの動作 | 問題なし(§3-1) |
| 本番でエラーが「Server Error」としか出ない | 素の `Error` を投げている箇所がある | 画面に出す文言は `ConvexError` で投げる(計画書 §12-12) |
