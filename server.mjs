import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("./dist/", import.meta.url)));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

if (!existsSync(join(root, "index.html"))) {
  console.error(`Missing built index.html in ${root}. Run node build.mjs first.`);
  process.exit(1);
}

const served = new Set();

const server = createServer((req, res) => {
  const method = req.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method not allowed");
    return;
  }
  let pathname = "/";
  try {
    pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }
  if (pathname.includes("\0")) {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }
  const relative = normalize(pathname).replace(/^([/\\])+/, "");
  let file = resolve(root, relative);
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) {
    const fallback = join(root, "index.html");
    if (existsSync(fallback) && !extname(pathname)) file = fallback;
    else {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
  }
  const type = mime[extname(file).toLowerCase()] || "application/octet-stream";
  const stat = statSync(file);
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": stat.size,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on("error", () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  stream.pipe(res);
});

server.on("error", (error) => {
  console.error(`Static server failed: ${error.message}`);
  process.exit(1);
});

server.listen(port, host, () => {
  served.add(port);
  console.log(`Gradual Ascent serving ${root} at http://${host}:${port}`);
});
