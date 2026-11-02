import { clampInt, compactText, previewText } from "../utils";

export function stylePromptForImage(
  prompt: string,
  style: "image" | "meme" | "quote_card"
): string {
  const base = compactText(prompt);
  if (style === "meme") {
    return `${base}. Meme-style visual, expressive composition, internet-culture energy, bold readable layout.`;
  }
  if (style === "quote_card") {
    return `${base}. Premium quote-card design, elegant typography, soft gradient background, highly readable text layout.`;
  }
  return `${base}. Photorealistic or high-quality digital art, clean composition, rich detail.`;
}

export function buildPollinationsImageUrl(args: {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  style: "image" | "meme" | "quote_card";
}): string {
  const prompt = stylePromptForImage(args.prompt, args.style);
  const width = clampInt(args.width, 512, 1536);
  const height = clampInt(args.height, 512, 1536);
  const seed = clampInt(args.seed, 1, 2147483647);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&model=flux&nologo=true`;
}

export function defaultImageCaption(
  style: "image" | "meme" | "quote_card",
  prompt: string
): string {
  const short = previewText(prompt, 72);
  if (style === "meme") return `meme drop: ${short}`;
  if (style === "quote_card") return "styled quote card";
  return `image: ${short}`;
}
