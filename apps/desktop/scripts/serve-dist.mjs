import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist");
const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 5173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8"
};

function resolvePath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://${host}:${port}`).pathname);
  const candidate = normalize(join(root, pathname));
  if (!candidate.startsWith(root)) {
    return null;
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }
  return join(root, "index.html");
}

createServer((request, response) => {
  const filePath = resolvePath(request.url ?? "/");

  if (!filePath || !existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  console.log(`Oghma Library mock: http://${host}:${port}/`);
});
