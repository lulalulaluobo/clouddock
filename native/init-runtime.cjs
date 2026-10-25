const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { createRequire } = require("node:module");

function initialize(root = "/app", env = process.env) {
  const runtimeRequire = createRequire(path.join(root, "package.json"));
  const dotenv = runtimeRequire("dotenv");
  for (const name of ["data", "config", "logs"]) fs.mkdirSync(path.join(root, name), { recursive: true });
  const target = path.join(root, "config/env"), exists = fs.existsSync(target);
  const stored = exists ? dotenv.parse(fs.readFileSync(target)) : {};
  let secret = env.JWT_SECRET || stored.JWT_SECRET;
  if (!secret && !exists) secret = randomBytes(32).toString("hex") + "Aa1!";
  if (!secret || secret.length < 32 || !/[A-Z]/.test(secret) || !/[a-z]/.test(secret) || !/\d/.test(secret) || !/[^A-Za-z0-9]/.test(secret)) throw new Error("JWT_SECRET 必须至少 32 位并包含大小写字母、数字和特殊字符；请检查环境变量或 config/env");
  if (!env.ARIA2_RPC_SECRET || env.ARIA2_RPC_SECRET.length < 32 || /[\r\n]/.test(env.ARIA2_RPC_SECRET)) throw new Error("请填写至少 32 位的 ARIA2_RPC_SECRET，并与 aria2 服务使用相同值");
  if (!fs.existsSync(path.join(root, "data/database.sqlite")) && !/^[1-9]\d{5,11}$/.test(env.ADMIN_USER_CODE || stored.ADMIN_USER_CODE || "")) throw new Error("首次启动请设置 6～12 位数字的 ADMIN_USER_CODE，用于注册第一个管理员");
  if (!exists) {
    const defaults = fs.readFileSync(path.join(root, ".env.example"), "utf8").replace(/^(?:JWT_SECRET|NODE_ENV)=.*$/gm, "");
    fs.writeFileSync(target, defaults.trimEnd() + "\nNODE_ENV=production\nJWT_SECRET=" + secret + "\n", { flag: "wx", mode: 0o600 });
    console.log("CloudDock 已初始化 config/env，JWT 密钥已独立生成/保存，不在日志中显示");
  }
  const releaseDefault = path.join(root, "release-content.local.default.json"), releaseTarget = path.join(root, "config/release-content.local.json");
  if (!fs.existsSync(releaseTarget) && fs.existsSync(releaseDefault)) fs.copyFileSync(releaseDefault, releaseTarget, fs.constants.COPYFILE_EXCL);
}
if (require.main === module) {
  try { initialize(); } catch (error) { console.error("CloudDock 启动配置错误：" + error.message); process.exitCode = 1; }
}
module.exports = { initialize };
