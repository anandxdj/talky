import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";

export function collectStickerFiles(rootDir: string, maxDepth: number, maxFiles: number): string[] {
  const files: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];

  while (queue.length > 0 && files.length < maxFiles) {
    const current = queue.shift();
    if (!current) break;

    for (const entry of readdirSync(current.dir)) {
      const absolute = path.join(current.dir, entry);
      const isDir = lstatSync(absolute).isDirectory();
      if (isDir) {
        if (current.depth < maxDepth) {
          queue.push({ dir: absolute, depth: current.depth + 1 });
        }
        continue;
      }
      if (path.extname(absolute).toLowerCase() === ".webp") {
        files.push(absolute);
      }
      if (files.length >= maxFiles) break;
    }
  }

  return files;
}
