const fs = require("fs");
const path = require("path");
const assert = require("assert");

function walk(root, output = []) {
  if (!fs.existsSync(root)) {
    return output;
  }

  for (
    const entry
    of fs.readdirSync(
      root,
      { withFileTypes: true },
    )
  ) {
    const next =
      path.join(
        root,
        entry.name,
      );

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git"
      ) {
        continue;
      }

      walk(
        next,
        output,
      );
    } else {
      output.push(next);
    }
  }

  return output;
}

const files = [];

for (
  const entry
  of fs.readdirSync(
    ".",
    { withFileTypes: true },
  )
) {
  if (
    entry.isFile() &&
    path.extname(entry.name)
      .toLowerCase() === ".html"
  ) {
    files.push(entry.name);
  }
}

walk("js", files);
walk("features", files);

const allowedExtensions =
  new Set([
    ".html",
    ".js",
    ".ts",
    ".css",
    ".json",
  ]);

const suspicious =
  /(?:\u00c3|\u00c2|\u00e2(?=[\u0080-\u00ff\u2018-\u203a\u20ac\u2122])|\u00f0\u0178|\u00ef\u00bf\u00bd|\ufffd|[\u0080-\u009f])/;

const hits = [];

for (
  const file
  of [...new Set(files)]
) {
  if (
    !allowedExtensions.has(
      path.extname(file)
        .toLowerCase(),
    )
  ) {
    continue;
  }

  if (
    file.endsWith(".min.js") ||
    file.endsWith(".map")
  ) {
    continue;
  }

  const lines =
    fs.readFileSync(
      file,
      "utf8",
    )
      .replace(/\r\n?/g, "\n")
      .split("\n");

  lines.forEach(
    (line, index) => {
      if (suspicious.test(line)) {
        hits.push(
          file +
          ":" +
          (index + 1) +
          ": " +
          line,
        );
      }
    },
  );
}

assert.deepStrictEqual(
  hits,
  [],
  "Mojibake source regression:\n" +
    hits.join("\n"),
);

console.log(
  "PASS: runtime source mojibake regression QA.",
);
