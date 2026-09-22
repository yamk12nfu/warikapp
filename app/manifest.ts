import type { MetadataRoute } from "next";
import { brand } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "warikapp",
    short_name: "warikapp",
    description: "ふたりの立て替えを、レシートから精算",
    lang: "ja",
    start_url: "/",
    display: "standalone",
    background_color: brand.background.light,
    theme_color: brand.background.light,
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // 同じ画像を maskable としても登録する。マークは中央60%に収めてあるので
      // Android の丸型・角丸マスク(安全域は中央80%)で欠けない
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
