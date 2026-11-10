const path = require("node:path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const expoModulesOnWindows = path.resolve(workspaceRoot, "packages/expo-windows/src/index.ts");
const windowsProject = path.resolve(projectRoot, "windows").replace(/[/\\]/g, "[/\\\\]");
const windowsBuildOutput = new RegExp(`^${windowsProject}[/\\\\].*`);

const config = mergeConfig(getDefaultConfig(projectRoot), {
  watchFolders: [workspaceRoot],
  resolver: {
    blockList: [windowsBuildOutput, /.*\.ProjectImports\.zip/],
    nodeModulesPaths: [path.resolve(workspaceRoot, "node_modules")],
    resolveRequest(context, moduleName, platform) {
      if (platform === "macos" && (moduleName === "react-native" || moduleName.startsWith("react-native/"))) {
        moduleName = moduleName.replace(/^react-native/, "react-native-macos");
      }
      if (platform === "windows") {
        if (moduleName === "expo-modules-core") return { type: "sourceFile", filePath: expoModulesOnWindows };
        if (moduleName === "react-native" || moduleName.startsWith("react-native/")) {
          moduleName = moduleName.replace(/^react-native/, "react-native-windows");
        }
      }
      if (process.env.AC_REACT_PROFILING === "1" && moduleName.endsWith("/ReactNativeRenderer-prod")) {
        moduleName = moduleName.replace(/-prod$/, "-profiling");
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
});

module.exports = config;
