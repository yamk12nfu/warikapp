"use node";

import { WebPushError, sendNotification } from "web-push";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { buildSettlementRequestPayload, shouldDropSubscription } from "../lib/push";
import { v } from "convex/values";

export const settlementRequested = internalAction({
  args: { settlementId: v.id("settlements") },
  handler: async (ctx, args) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (!publicKey || !privateKey || !subject) {
      console.warn("Web Push は VAPID 環境変数が未設定のため送信しません");
      return null;
    }

    const details = await ctx.runQuery(
      internal.push.settlementRequestDetails,
      args,
    );
    if (details === null) {
      return null;
    }
    const subscriptions = await ctx.runQuery(internal.push.listForMember, {
      memberId: details.memberId,
    });
    const payload = JSON.stringify(
      buildSettlementRequestPayload({
        actorName: details.actorName,
        amount: details.amount,
        expenseCount: details.expenseCount,
      }),
    );

    for (const subscription of subscriptions) {
      try {
        await sendNotification(subscription, payload, {
          vapidDetails: { subject, publicKey, privateKey },
        });
      } catch (error) {
        const statusCode =
          error instanceof WebPushError ? error.statusCode : undefined;
        if (shouldDropSubscription(statusCode)) {
          try {
            await ctx.runMutation(internal.push.removeByEndpoint, {
              endpoint: subscription.endpoint,
              memberId: details.memberId,
            });
          } catch (cleanupError) {
            console.error("期限切れの Web Push 購読を削除できませんでした", cleanupError);
          }
          continue;
        }
        console.error("Web Push 通知を送信できませんでした", error);
      }
    }
    return null;
  },
});
