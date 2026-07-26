import { describe, expect, test } from "vitest";
import { ReceiptSchema, receiptJsonSchema } from "./schema";

// GeminiにはJSON Schemaを渡すので、zodのスキーマから正しく生成できることを見る
// (二重管理をやめた結果、ここがズレるとGemini側だけ壊れるため)。

describe("receiptJsonSchema", () => {
  const jsonSchema = receiptJsonSchema();

  test("Geminiがサポートしないキー($schema)を含まない", () => {
    expect(jsonSchema.$schema).toBeUndefined();
  });

  test("抽出結果のフィールドが揃っている", () => {
    expect(jsonSchema.type).toBe("object");
    const properties = jsonSchema.properties as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual([
      "items",
      "purchased_at",
      "store_name",
      "total_amount",
    ]);
    expect(jsonSchema.required).toEqual(
      expect.arrayContaining([
        "store_name",
        "purchased_at",
        "total_amount",
        "items",
      ]),
    );
  });

  // 説明が落ちると、購入日が「2026年7月21日」の形で返ってきて静かに捨てられる
  test("各フィールドの説明がJSON Schemaに載る(AIに渡る)", () => {
    const properties = jsonSchema.properties as Record<
      string,
      { description?: string }
    >;
    expect(properties.purchased_at.description).toContain("YYYY-MM-DD");
    expect(properties.store_name.description).toBeTruthy();
    expect(properties.total_amount.description).toBeTruthy();
  });

  test("金額と数量は整数として要求する", () => {
    const items = (jsonSchema.properties as Record<string, never>)
      .items as unknown as {
      items: { properties: Record<string, { type: string }> };
    };
    expect(items.items.properties.price.type).toBe("integer");
    expect(items.items.properties.quantity.type).toBe("integer");
  });
});

describe("ReceiptSchema", () => {
  test("AIの応答形をそのまま検証できる", () => {
    const parsed = ReceiptSchema.safeParse({
      store_name: "スーパーやまだ",
      purchased_at: "2026-07-20",
      total_amount: 1000,
      items: [{ name: "牛肉", price: 600, quantity: 1 }],
    });
    expect(parsed.success).toBe(true);
  });

  test("店名・購入日はnullを許す(判読できない場合)", () => {
    const parsed = ReceiptSchema.safeParse({
      store_name: null,
      purchased_at: null,
      total_amount: 0,
      items: [],
    });
    expect(parsed.success).toBe(true);
  });

  test("金額が小数なら不適合(リトライ対象になる)", () => {
    const parsed = ReceiptSchema.safeParse({
      store_name: null,
      purchased_at: null,
      total_amount: 1000,
      items: [{ name: "牛肉", price: 600.5, quantity: 1 }],
    });
    expect(parsed.success).toBe(false);
  });
});
