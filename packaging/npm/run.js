// Runs one of the binaries from the platform package npm installed beside
// this one (an optional dependency picked by its "os" and "cpu" fields).
// stdin and stdout pass straight through, so MCP clients talk to sp-mcp
// directly; signals are forwarded and the exit status is passed back.
"use strict";

const { spawn } = require("node:child_process");

module.exports = function run(name) {
  const pkg = `@SCOPE@/super-productivity-mcp-${process.platform}-${process.arch}`;
  let bin;
  try {
    bin = require.resolve(`${pkg}/bin/${name}`);
  } catch {
    console.error(
      `${name}: ${pkg} is not installed. The npm packages cover Linux and macOS on x64 and arm64; ` +
        "if your system is one of those, reinstall without --omit=optional or --no-optional.",
    );
    process.exit(1);
  }
  const child = spawn(bin, process.argv.slice(2), { stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (err) => {
    console.error(`${name}: ${err.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
};
