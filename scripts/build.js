const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");

require("./build-check");

fs.rmSync(dist, { recursive: true, force: true });
copyFile("index.html");
copyDir("src", "src");

console.log("Tadoo static assets copied to dist.");

function copyFile(relativePath) {
  const source = path.join(root, relativePath);
  const target = path.join(dist, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDir(relativeSource, relativeTarget) {
  const source = path.join(root, relativeSource);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(relativeSource, entry.name);
    const targetPath = path.join(relativeTarget, entry.name);
    if (entry.isDirectory()) copyDir(sourcePath, targetPath);
    else copyFileTo(sourcePath, targetPath);
  }
}

function copyFileTo(relativeSource, relativeTarget) {
  const source = path.join(root, relativeSource);
  const target = path.join(dist, relativeTarget);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}
