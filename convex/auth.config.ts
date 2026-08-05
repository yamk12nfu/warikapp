// Clerk連携設定。CLERK_JWT_ISSUER_DOMAIN には Clerk の JWTテンプレート「convex」の
// Issuer URL を Convex の環境変数として登録する(未設定だとデプロイが失敗する)。
const authConfig = {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
