import * as esbuild from "esbuild";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { build as viteBuild } from "vite";
import { runTests } from "@vscode/test-electron";

const projectRoot = process.cwd();
const outputDirectory = resolve(projectRoot, "07-artifacts-安装包");
const webviewRoot = resolve(projectRoot, "03-webview-阅读界面");
const extensionIconSource = resolve(projectRoot, "00-config-工程配置/icon-扩展图标.png");
const extensionIconOutput = resolve(outputDirectory, "icon-扩展图标.png");
const operation = process.argv[2] ?? "build";

if (basename(outputDirectory) !== "07-artifacts-安装包") {
  throw new Error(`Refusing to use unexpected output path: ${outputDirectory}`);
}

const extensionBuildOptions = {
  entryPoints: ["01-extension-扩展逻辑/extension-扩展入口.ts"],
  outfile: "07-artifacts-安装包/extension-扩展入口.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  minify: true,
  external: ["vscode"],
  logLevel: "info"
};

async function clean() {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, ".gitkeep"), "");
}

async function buildExtension() {
  await mkdir(outputDirectory, { recursive: true });
  await esbuild.build(extensionBuildOptions);
}

async function buildWebview() {
  // IIFE：VS Code / Cursor webview 对 type=module 兼容性差，空白页多半卡在这里
  await viteBuild({
    configFile: false,
    root: webviewRoot,
    base: "./",
    resolve: {
      alias: {
        "react/jsx-runtime": "preact/jsx-runtime",
        "react/jsx-dev-runtime": "preact/jsx-dev-runtime"
      }
    },
    build: {
      outDir: resolve(outputDirectory, "webview"),
      emptyOutDir: true,
      target: "es2022",
      sourcemap: false,
      cssCodeSplit: false,
      lib: {
        entry: resolve(webviewRoot, "webview-main-主界面.tsx"),
        name: "YamlReaderWebview",
        formats: ["iife"],
        fileName: () => "webview-main-主界面.js",
        cssFileName: "webview"
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          assetFileNames: (assetInfo) =>
            assetInfo.names?.some((name) => name.endsWith(".css"))
              ? "webview-style-页面样式.css"
              : "assets/[name]-[hash][extname]"
        }
      }
    }
  });
}

async function build() {
  await clean();
  await copyFile(extensionIconSource, extensionIconOutput);
  await buildExtension();
  await buildWebview();
}

async function runIntegration() {
  await esbuild.build({
    entryPoints: ["05-tests-测试/integration-集成测试/01_integration-集成测试/suite/extension-integration-扩展集成.ts"],
    outfile: "07-artifacts-安装包/tests_集成/suite/extension-integration-扩展集成.js",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    logLevel: "info"
  });
  const temporaryRoot = await mkdtemp(join(tmpdir(), "yaml-reader-vscode-test-"));
  try {
    await runTests({
      extensionDevelopmentPath: projectRoot,
      extensionTestsPath: resolve(
        outputDirectory,
        "tests_集成/suite/extension-integration-扩展集成.js"
      ),
      launchArgs: [
        resolve(projectRoot, "05-tests-测试/integration-集成测试/01_integration-集成测试/workspace_工作区"),
        "--disable-extensions",
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
        `--user-data-dir=${join(temporaryRoot, "user")}`,
        `--extensions-dir=${join(temporaryRoot, "extensions")}`
      ]
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (operation === "clean") await clean();
else if (operation === "build") await build();
else if (operation === "integration") await runIntegration();
else if (operation === "watch") {
  await mkdir(outputDirectory, { recursive: true });
  const context = await esbuild.context({ ...extensionBuildOptions, minify: false });
  await context.watch();
  console.log("Watching Extension Host sources...");
} else {
  throw new Error(`Unknown project operation: ${operation}`);
}
