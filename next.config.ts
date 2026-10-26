import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

const projectRequire = createRequire(join(process.cwd(), "package.json"));
const tesseractPackage = projectRequire.resolve("tesseract.js/package.json");
const tesseractRequire = createRequire(tesseractPackage);

function workerRuntimeFiles(packageName: string, files: string[]) {
  const resolvedDirectory = dirname(tesseractRequire.resolve(`${packageName}/package.json`));
  const linkedDirectory = join(dirname(dirname(tesseractPackage)), packageName);
  // Include pnpm's dependency aliases as well as their real package locations.
  return [...new Set([resolvedDirectory, linkedDirectory])].flatMap((directory) => {
    const root = relative(process.cwd(), directory).replaceAll("\\", "/");
    return files.map((file) => `${root}/${file}`);
  });
}

const workerFiles = [
  ...workerRuntimeFiles("tesseract.js", ["src/worker-script/**/*.js", "src/constants/imageType.js"]),
  ...workerRuntimeFiles("tesseract.js-core", [
    "package.json",
    "tesseract-core{,-lstm,-simd,-simd-lstm,-relaxedsimd,-relaxedsimd-lstm}.{js,wasm}",
  ]),
  ...workerRuntimeFiles("wasm-feature-detect", ["package.json", "dist/cjs/*.cjs"]),
  ...workerRuntimeFiles("bmp-js", ["package.json", "index.js", "lib/*.js"]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The OCR worker loads its own modules outside Next.js's bundled route.
  serverExternalPackages: ["tesseract.js"],
  outputFileTracingIncludes: {
    "/api/telegram/webhook": workerFiles,
  },
};

export default nextConfig;
