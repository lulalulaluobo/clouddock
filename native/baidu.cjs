const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PublicError } = require('./core.cjs');

class Baidu {
  constructor({ socket = process.env.BAIDU_BRIDGE_SOCKET || '/run/clouddock-baidu/bridge.sock', config = process.env.BAIDU_PAIRING_FILE || '/app/config/baidu-pairing.json' } = {}) { this.socket = socket; this.config = config; }
  async key() { try { return JSON.parse(await fs.readFile(this.config, 'utf8')).key; } catch { throw new PublicError('请在设置中连接飞牛百度网盘', 503); } }
  async call(action, owner, body = {}, key) {
    key = key || await this.key();
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{32,128}$/.test(key)) throw new PublicError('配对码格式无效');
    const data = JSON.stringify({ ...body, _owner: String(owner) });
    return new Promise((resolve, reject) => {
      const req = http.request({ socketPath: this.socket, path: action, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Authorization: 'Bearer ' + key } }, res => {
        let value = '';
        res.on('data', chunk => { value += chunk; if (value.length > 8 * 1024 * 1024) req.destroy(); });
        res.on('end', () => { try { const result = JSON.parse(value); if (!result.success) reject(new PublicError(result.message || '飞牛百度请求失败', 502)); else resolve(result.data); } catch { reject(new PublicError('适配服务响应无效', 502)); } });
      });
      req.setTimeout(30000, () => req.destroy());
      req.on('error', () => reject(new PublicError('无法连接飞牛百度适配服务，请检查安装及 socket 挂载', 503)));
      req.end(data);
    });
  }
  async pair(owner, key) {
    const status = await this.call('/health', owner, {}, key);
    await fs.mkdir(path.dirname(this.config), { recursive: true });
    const temporary = this.config + '.tmp';
    await fs.writeFile(temporary, JSON.stringify({ key }), { mode: 0o600 });
    await fs.rename(temporary, this.config);
    return status;
  }
  async health(owner) { try { return await this.call('/health', owner); } catch (e) { return { connected: false, message: e instanceof PublicError ? e.message : '无法读取百度连接状态' }; } }
}
module.exports = { Baidu };
