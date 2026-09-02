import * as a1lib from "alt1/base";

/**
 * Capture the current RuneScape client view as a PNG blob.
 * Returns null if capture isn't available (no Alt1, no pixel permission, game closed).
 */
export async function captureScreenshot(): Promise<Blob | null> {
  try {
    const cap = a1lib.captureHoldFullRs();
    const data = cap.toData();

    const canvas = document.createElement("canvas");
    canvas.width = data.width;
    canvas.height = data.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.putImageData(data, 0, 0);

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
  } catch {
    return null;
  }
}
