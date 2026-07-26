// レシート画像のクライアント側縮小・圧縮(要件 F-003 / 計画書 10.4)。
// 長辺2,000pxに縮小してJPEG(quality 0.8)へ再エンコードする。
// 再エンコードはHEIC対策も兼ねる(iPhoneのHEICがそのまま来てもCanvasを通せばJPEGになる)。

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 要件: 20MB以下
export const MAX_LONG_EDGE = 2000;
const JPEG_QUALITY = 0.8;

export const ERR_TOO_LARGE = "画像が大きすぎます(20MBまで)";
export const ERR_DECODE = "画像を読み込めませんでした。別の画像でお試しください";

// 長辺が max を超えるときだけ縮小した寸法を返す(拡大はしない)。
// 純粋関数なのでテストできる(Canvasを触る部分と切り分けてある)。
export function fitWithinLongEdge(
  width: number,
  height: number,
  max: number = MAX_LONG_EDGE,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= max || longEdge === 0) {
    return { width, height };
  }
  const scale = max / longEdge;
  // Canvasの寸法は整数。0にならないよう最低1pxを保証する
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// 画像ファイルを縮小・JPEG圧縮したBlobにする。ブラウザ専用。
export async function compressReceiptImage(file: File): Promise<Blob> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(ERR_TOO_LARGE);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(ERR_DECODE);
  }

  try {
    const { width, height } = fitWithinLongEdge(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error(ERR_DECODE);
    }
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
    });
    if (blob === null) {
      throw new Error(ERR_DECODE);
    }
    return blob;
  } finally {
    bitmap.close();
  }
}
