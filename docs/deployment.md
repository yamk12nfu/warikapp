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

### ⚠️ 先に用意すること: 自分のドメイン

**Clerkの本番インスタンスは、自分が所有するドメインが必須**。Clerkのダッシュボードが指示する
CNAMEレコードを自分で追加する必要があるため、`*.vercel.app` のような借り物のドメインでは作れない。
Vercel側にもそのドメインを追加する(§3-3)。

**開発インスタンス(`pk_test_...`)のまま公開するのは避けること。** Clerkは開発インスタンスを
「本番のワークロードには適さない」と明言していて、理由はユーザー数上限(100)だけではない:

- 開発インスタンスはセッションを `__clerk_db_jwt` として**クエリ文字列で運ぶ**。この値は
  サーバーログやブラウザ履歴にそのまま残る
- そもそも開発用にセキュリティ姿勢を緩めてある

どうしてもドメインが間に合わないときの暫定運用は §1-alt に書いたが、**実運用を始める前に
ドメインを取ること**。年1,000〜2,000円程度で、取得直後から使える(DNSの反映に最大48時間かかると
Clerkは案内しているが、実際は数分〜数時間で通ることが多い)。

### 用意するもの

- Googleアカウント(Google Cloud Console と Google AI Studio 用)
- Clerk / Vercel のアカウント
- ドメイン(上記のとおり)

### 所要時間の目安

DNSの反映待ちを除いて 1〜1.5時間。DNSを待つ場合はそこで一度中断できる(§1-2 まで進めて放置 → 反映後に §1-3 から再開)。

### 全体の順序

ドメインが Clerk と Vercel の両方に要るので、行ったり来たりする。迷ったらこの並びに戻る。

```
§1-1 Clerk本番インスタンス作成
§1-2 Clerk Domains にドメイン登録 → CNAMEをDNSに追加(反映待ち)
§1-3 Clerk でリダイレクトURIを表示 → Google Cloud で OAuthクライアント作成 → Clerkに貼る
§1-4 JWTテンプレート convex を作成 → Issuer URL を控える
§1-5 Allowed Subdomains を絞る
§1-6 Clerk で「Deploy certificates」を押して本番インスタンスを有効化
§1-7 pk_live / sk_live を控える
§2   Convex prod に環境変数を登録
§3   Vercel に Import(環境変数3つ)→ Deploy → ドメイン追加 → 許可オリジンを足して再デプロイ
§4   ローカルでの事前確認(§3 の前にやってもよい)
```

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
3. **サブドメインを入れた場合、Clerkは「Primary application か Secondary application か」を聞いてくる。**
   どちらを選ぶかでClerk基盤のホスト名が変わる(`clerk.example.com` になるか
   `clerk.warikapp.example.com` になるか)。**どちらでも動く**が、以降の手順で使う
   リダイレクトURIとIssuer URLは**必ずClerkの画面に出ている実物をコピーする**こと
   (この手順書の `clerk.<あなたのドメイン>` はあくまで例)
4. 表示されるCNAMEレコード(5件前後。`clerk`, `accounts`, `clkmail`, `clk._domainkey` など)を
   **画面に出ているとおりに**ドメインのDNS設定に追加する
5. Clerkの画面でレコードが緑になるまで待つ

> ⚠️ Cloudflare をDNSに使っている場合、**プロキシ(オレンジの雲)はOFF**にする。ONだとClerkの
> 検証が通らない。

> Vercel用のDNSレコード(§3-3)とは別名なので競合しない。両方が要る。

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
   - **承認済みの JavaScript 生成元**: **アプリのドメインを入れる**(例: `https://warikapp.example.com`。
     `www` 付きも使うなら両方)。Clerkの手順が明示的に要求している
   - **承認済みのリダイレクト URI**: 上でコピーしたClerkのURIを貼る
     - ⚠️ 末尾スラッシュの有無・大文字小文字の違いでも一致しない。**貼り付けるだけで手打ちしない**
   - 作成 → **クライアントID** と **クライアントシークレット** をコピー

Clerkに戻る:

4. 1-3 の Google の画面に **Client ID** と **Client Secret** を貼って保存

### 1-4. JWTテンプレート `convex` を作る

1. Clerk Dashboard(本番インスタンス)→ **Configure** → **JWT Templates** → **New template** → **Convex**
2. ⚠️ **テンプレート名は `convex`(小文字)のまま変えない**。`convex/auth.config.ts` の
   `applicationID: "convex"` と一致している必要がある
3. 保存し、**Issuer URL**(`https://clerk.<あなたのドメイン>` の形)をコピー → §2 で使う

### 1-5. Allowed Subdomains を絞る

1. Clerk Dashboard(本番インスタンス)→ **Allowed Subdomains**
2. **Enable allowed subdomains** をONにする
3. このアプリが使うサブドメインだけを登録する(例: `warikapp`)

**なぜ必要か**: Clerkは既定でルートドメイン配下の**どのサブドメインからでも**Frontend APIへの
リクエストを許す。同じルートドメインに別のサイト(ブログなど)を置いていて、そちらが乗っ取られると、
そこからこのアプリの認証フローに手が届く。Clerkも本番では有効化を強く推奨している。

⚠️ **`CLERK_AUTHORIZED_PARTIES`(§3-4)だけでは足りない。** あちらが効くのは Next.js の Proxy を
通るリクエストだけで、**画面のデータはClerkのJWTを直接Convexへ送る経路で流れている**。
Convex側(`convex/auth.config.ts`)は Issuer と `applicationID` しか検証しないため、Proxy側の
検査は迂回できる。Clerk側で塞ぐのがこの設定。

### 1-6. 証明書をデプロイして本番インスタンスを有効化する

1. Clerk Dashboard → **Domains**
2. DNSレコードがすべて緑になっていることを確認
3. **Deploy certificates** を押す

⚠️ **この操作を飛ばすと本番インスタンスが有効にならない。** DNSを張っただけでは動かない。

### 1-7. 本番APIキーを控える

Clerk Dashboard → **API Keys** → `pk_live_...`(Publishable key)と `sk_live_...`(Secret key)を
コピー → §3 で使う。

---

## 1-alt. ドメインが間に合わないときの暫定運用(推奨しない)

Clerkの**開発インスタンスは本番URLからでも動く**ので、ドメインの取得・DNS反映を待つ間の
つなぎとしては使える。**ただし恒久的な運用にはしないこと**(§0 のとおり、Clerk自身が本番の
ワークロードには適さないと明言している)。

- 使うキーは今の `pk_test_...` / `sk_test_...`(`.env.local` にあるもの)
- Issuer URL も今 Convex の dev に入れているもの(`npx convex env get CLERK_JWT_ISSUER_DOMAIN` で確認できる)
- Google OAuth の自前設定は不要(Clerkの共有認証がそのまま使える)

受け入れることになるもの:

| 制約 | 中身 |
|---|---|
| **セッションの扱い** | 開発インスタンスは `__clerk_db_jwt` を**クエリ文字列で運ぶ**。サーバーログ・ブラウザ履歴・拡張機能から見える。ここが「推奨しない」の主因 |
| **セキュリティ姿勢** | 開発用に全体的に緩めてある(Clerkのドキュメントの表現) |
| ユーザー数 | 上限100ユーザー。インスタンス間でユーザーデータは移せない |
| 同意画面 | Googleのログイン画面に Clerk の名前が出る(自分のアプリ名にはならない) |
| 本番への移行 | あとからドメインを取って §1 をやり直せる。**そのときユーザーは作り直しになる**(招待からやり直し) |

> **§2 以降では「本番Clerkの値」を「開発Clerkの値」に読み替えること**
> (Convexのprodには開発ClerkのIssuer URLを入れる)。§1-5 / §1-6 は不要。
>
> 暫定で始めた場合は、レシートや精算の実データを入れる前にドメインを用意して §1 に移ること。
> データが増えてからだとユーザーの作り直しが痛くなる。

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

APIキーはシェル履歴に残したくないので、値を省いて対話入力にする:

```bash
npx convex env set GEMINI_API_KEY --prod
```

登録できたか確認(名前だけ見るなら `--names-only` を付ける。値も出るので画面共有中は注意):

```bash
npx convex env list --names-only --prod
```

ダッシュボードからやる場合は [Convex Dashboard](https://dashboard.convex.dev/d/accurate-capybara-527) →
右上で **Production** を選択 → **Settings → Environment Variables**。

---

## 3. Vercel

> **順序に注意**: 環境変数は Import 画面(Configure Project)で入れられるが、
> **ドメインはプロジェクトが作られてからでないと追加できない**。
> `CLERK_AUTHORIZED_PARTIES` は本番URLが確定してから入れるので、最後に足して再デプロイになる。
>
> ```
> 3-1 Import(Configure Project で 3-2 の環境変数を入れてから Deploy)
> 3-2 環境変数(CLERK_AUTHORIZED_PARTIES を除く3つ)
> 3-3 Settings → Domains でカスタムドメインを追加
> 3-4 CLERK_AUTHORIZED_PARTIES を足して再デプロイ
> 3-5 仕上げ
> ```

### 3-1. Import

1. [Vercel](https://vercel.com/new) → GitHub の `warikapp` リポジトリを Import
2. Framework Preset は `Next.js` が自動検出される(そのままでよい)
3. **Configure Project の画面で §3-2 の環境変数3つを入れてから** Deploy を押す
   (入れずにDeployすると `CONVEX_DEPLOY_KEY` が無くて初回ビルドが落ちる。落ちても
   あとから環境変数を入れて再デプロイすれば直る)
4. ⚠️ **Build Command は触らない**。リポジトリの `vercel.json` に書いてあり、そちらが
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

### 3-2. 環境変数(Import時に入れる3つ)

Import画面の **Environment Variables**(あとから足すなら Settings → Environment Variables)。

| 変数 | 値 | Environment |
|---|---|---|
| `CONVEX_DEPLOY_KEY` | Convex Dashboard → **Production** → Settings → **Deploy Keys** → *Generate Production Deploy Key* | ⚠️ **Production だけにチェック** |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_...`(§1-7) | Production |
| `CLERK_SECRET_KEY` | `sk_live_...`(§1-7) | Production |

> ⚠️ Vercelで環境変数を足すと **既定で Production / Preview / Development の3つ全部にチェックが入る**。
> `CONVEX_DEPLOY_KEY` は必ず Production だけに絞る(`ignoreCommand` で二重に防いではいるが、
> 元を断っておく)。

> ⚠️ **`NEXT_PUBLIC_CONVEX_URL` は設定しない**。`npx convex deploy --cmd` がビルド時に
> 本番のURL(`https://accurate-capybara-527.convex.cloud`)を自動で渡す。手で入れると、将来
> デプロイ先を変えたときに古い値が残って「本番なのに開発のデータが見える」状態になる。

Deployが成功すると、ビルドログに `Deploying to https://accurate-capybara-527.convex.cloud` の
ような行が出る。これが出ていれば Convex 側も一緒にデプロイされている。

### 3-3. カスタムドメインを追加する

**Clerk本番インスタンスを使うなら必須。** `*.vercel.app` のままでは本番のClerkキーが使えない(§0)。

1. Vercel の **Settings → Domains** → §1-2 で Clerk に登録したのと**同じドメイン**を追加
2. 表示されたDNSレコード(A または CNAME)をドメインのDNS設定に追加する
   - Clerkが要求する `clerk.` などのサブドメイン用CNAMEとは**別名のレコード**。競合しないので両方入れる
3. Vercelの画面でドメインが有効になるまで待つ

### 3-4. `CLERK_AUTHORIZED_PARTIES` を足して再デプロイ

本番URLが確定してから入れる。

| 変数 | 値 | Environment |
|---|---|---|
| `CLERK_AUTHORIZED_PARTIES` | 本番URL(例: `https://warikapp.example.com`。複数あればカンマ区切り) | Production |

入れたら **Deployments → 最新 → Redeploy**。

> これを入れると `proxy.ts` が「このオリジンから来たトークンだけを受け付ける」ようClerkに指示する。
> Clerkは `azp` と**完全一致**で判定するので、表記ゆれがあると**全員ログインできなくなる**。
> `proxy.ts` 側でURLとして解釈してオリジンに正規化している(末尾スラッシュ・大文字・`:443` は吸収される)
> が、**URLとして解釈できない値(`example.com` のようにスキームが無いもの)は無視される**。
> 必ず `https://` から書くこと。設定後は必ずログインし直して確認する。

> ⚠️ **これだけでは足りない。** 効くのは Next.js の Proxy を通るリクエストだけで、画面のデータは
> ClerkのJWTを直接Convexへ送る経路で流れている。サブドメインからの迂回は
> **Clerkの Allowed Subdomains(§1-5)** で塞ぐこと。

### 3-5. デプロイ後の仕上げ

1. カスタムドメインで本番URLを開き、Googleログインが通ることを確認する
2. Clerk Dashboard(本番インスタンス)→ **Paths** で、サインイン後のリダイレクト先が
   `/` になっていることを確認する
3. `docs/verification-checklist.md` の §6 を上から潰す

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

> このコマンドは **本番を対象にする**ので、実行途中で
> 「Do you want to push your code to your prod deployment ... now?」と聞かれる。
> **`--dry-run` が付いている限り、`y` と答えても実際のデプロイは行われない**
> (`Deployed` ではなく `Would have deployed` と出る。`--cmd` のビルドも実行されない)。
> むしろ `n` と答えるとその手前でCLIが終了して、見たかった差分が出ない。
>
> ⚠️ 危ないのは **`--dry-run` の付け忘れ**のほう。同じプロンプトが出て、`y` と答えると
> **本当にデプロイされる**。コマンドをコピペしたら実行前に末尾を必ず確認すること。

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
| **昨日まで入れていたのに急に全員ログインできなくなった** | `CLERK_AUTHORIZED_PARTIES` の値が本番URLと一致していない(スキーム無し・別ドメイン・タイポ)。Clerkは完全一致で判定する | §3-4。切り分けは変数を消して再デプロイ(消せば検査なしに戻る) |
| ログインは通るのに、別サブドメインからもデータが取れてしまう | Clerkの **Allowed Subdomains** が未設定。`CLERK_AUTHORIZED_PARTIES` はConvexへの直接アクセスには効かない | §1-5 |
| 本番でエラーが「Server Error」としか出ない | 素の `Error` を投げている箇所がある | 画面に出す文言は `ConvexError` で投げる(計画書 §12-12) |
