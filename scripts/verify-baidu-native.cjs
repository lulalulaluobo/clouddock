const { createRequire } = require('node:module'), assert = require('node:assert/strict');
const req = createRequire('/app/package.json'), { Sequelize, DataTypes, Op } = req('sequelize');
const { BaiduNative } = require('../native/baidu-native.cjs'), { Directories } = require('../native/core.cjs');
const db = new Sequelize('sqlite::memory:', { logging: false });
const client = new BaiduNative({ sqlite3: req('sqlite3'), axios: req('axios'), sequelize: db, DataTypes, Op, paths: new Directories(), binding: '/tmp/baidu-smoke-binding.json' });
(async () => {
  await client.initialize(); const result = await client.authorize(); assert.equal(result.connected, true); assert.equal(result.nasMember, true);
  const share = await client.call('/share', 'test', { shareCode: '1q9IORb2Rx5mNVcNQ-IlaJA', receiveCode: 'jt1c', parentId: '/' });
  assert.ok(share.list.length); const target = await client.target({ rootId: 'media', relativePath: '' });
  assert.equal(target.sdk, '/vol3/2T/飞牛影视');
  console.log(JSON.stringify({ connected: true, nasMember: true, shareItems: share.list.length, pathMapping: true }));
})().catch(error => { console.error(error.name, error.message); process.exitCode = 1; }).finally(async () => { await client.stop(); await db.close(); });
