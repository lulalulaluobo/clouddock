const http = require("node:http");
function check(port, route, statuses) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: "127.0.0.1", port, path: route, timeout: 3000 }, response => { response.resume(); statuses.includes(response.statusCode) ? resolve() : reject(new Error("unhealthy")); });
    request.on("timeout", () => request.destroy(new Error("timeout"))); request.on("error", reject);
  });
}
Promise.all([check(8008, "/", [200]), check(8009, "/health", [200, 401])]).catch(() => { process.exitCode = 1; });
