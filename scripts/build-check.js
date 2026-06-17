const fs = require("node:fs");
const path = require("node:path");

const required = [
  "index.html",
  "src/styles.css",
  "src/js/app.js",
  "src/js/api.js",
  "src/js/storage.js",
  "netlify/functions/tadoo-profile.js",
  "netlify/database/migrations/20260617000100_tadoo_accounts.sql"
];

const missing = required.filter((file) => !fs.existsSync(path.join(__dirname, "..", file)));
if (missing.length) {
  console.error(`Missing required files:\n${missing.map((file) => `- ${file}`).join("\n")}`);
  process.exit(1);
}

console.log("Tadoo build check passed.");
