const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const ts = require("typescript");

// Run the actual source with isolated network/database dependencies; no real bot calls.
module.exports = function loadTypeScript(file, { modules = {}, globals = {} } = {}) {
  const filename = path.resolve(file);
  const localRequire = createRequire(filename);
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports,
    require: name => Object.hasOwn(modules, name) ? modules[name] : name.startsWith("@/") ? loadTypeScript(name.slice(2) + (fs.existsSync(name.slice(2) + ".ts") ? ".ts" : ".tsx"), { modules, globals }) : localRequire(name),
    Buffer, URL, Request, Response, Headers, AbortSignal, ReadableStream, setTimeout, clearTimeout, console,
    ...globals,
  }, { filename });
  return module.exports;
};
