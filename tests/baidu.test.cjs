const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { Baidu } = require('../native/baidu.cjs');
test('Unix 适配器配对成功才持久化，认证信息不返回，错误不会泄露密钥', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'baidu-'));
  const socket = path.join(directory, 'bridge.sock'), config = path.join(directory, 'pair.json'), key = 'test_only_pairing_key_123456789012345';
  const server = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk;
    assert.equal(JSON.parse(data)._owner, 'owner');
    res.end(JSON.stringify(req.headers.authorization === 'Bearer ' + key ? { success: true, data: { connected: true } } : { success: false, message: '配对码不正确' }));
  });
  await new Promise(resolve => server.listen(socket, resolve));
  try {
    const client = new Baidu({ socket, config });
    await assert.rejects(client.pair('owner', 'wrong_key_1234567890123456789012345'));
    await assert.rejects(fs.stat(config));
    const status = await client.pair('owner', key);
    assert.deepEqual(status, { connected: true });
    assert.equal((await fs.stat(config)).mode & 0o777, 0o600);
    assert.equal((await client.health('owner')).connected, true);
    assert.ok(!JSON.stringify(status).includes(key));
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true }); }
});
