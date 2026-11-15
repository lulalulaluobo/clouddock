const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { BaiduNative, parseJson, idList, cloudPath } = require('../native/baidu-native.cjs');
const { Directories } = require('../native/core.cjs');
function instance() { return Object.create(BaiduNative.prototype); }
test('选中文件夹只展开该子树，以文件 ID 下载并保留本地层级', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bd-folder-')), client = instance(), calls = [];
  client.paths = new Directories([{ id: 'media', label: 'media', browse: root, aria: root }]); client.persist = async () => {};
  client.own = async parent => parent === '/saved/movie' ? [{ fs_id: 21, path: '/saved/movie/part', server_filename: 'part', isdir: 1 }] : [{ fs_id: 22, server_filename: 'film.mkv', isdir: 0 }];
  client.api = async (_endpoint, _query, body) => { calls.push(body); return { errno: 0, list: [{ fs_id: 22, task_id: '21792924462000002', path: '/saved/movie/part/film.mkv' }] }; };
  const job = { account: 'a', target: { rootId: 'media', relativePath: '' } };
  try {
    await client.submitDownloads(job, [{ fs_id: 20, path: '/saved/movie', server_filename: 'movie', isdir: 1 }], { sdk: '/vol3/Films' });
    assert.equal(calls[0].fs_ids, '[22]'); assert.equal(calls[0].save_path, '/vol3/Films/movie/part');
    assert.equal(job.downloadTasks[0].localPath, 'movie/part/film.mkv'); assert.ok((await fs.stat(path.join(root, 'movie/part'))).isDirectory());
    await client.submitDownloads(job, [], { sdk: '/vol3/Films' }); assert.equal(calls.length, 1);
  } finally { await fs.rm(root, { recursive: true }); }
});
test('部分创建失败保留已接受的任务，后续批次停止，不冒充鉴权失败', async () => {
  const client = instance(); client.persist = async () => {}; client.ensureLocalDirectory = async () => {};
  client.api = async () => ({ errno: 42620, list: [{ fs_id: 1, task_id: '21792924462000002', path: '/one' }] });
  const job = { target: {}, downloadPlan: [{ fid: '1', path: 'one' }, { fid: '2', path: 'two' }, { fid: '3', path: 'other/three' }] };
  await client.submitDownloads(job, [], { sdk: '/media' });
  assert.equal(job.downloadTasks.length, 1); assert.equal(job.uncertain, false); assert.match(job.submissionError, /已接受 1\/3/);
  client.credentials = async () => ({ token: 'test', device: 'test' });
  client.axios = { request: async () => ({ data: '{"errno":42620,"list":[],"succ_count":0}' }) };
  assert.equal((await BaiduNative.prototype.api.call(client, '/rest/2.0/xpan/nas', { method: 'download' }, {})).errno, 42620);
});
test('17 位 SDK 任务 ID 保持精度，路径与 ID 拒绝注入', () => {
  assert.equal(parseJson('{"task_id":21792924462000002,"name":"21792924462000002"}').task_id, '21792924462000002');
  assert.equal(idList(['21792924462000002']), '[21792924462000002]');
  assert.throws(() => idList(['1],2'])); assert.throws(() => cloudPath('/a/../b'));
});
test('授权仅持久化账号指纹，切换账号需重新授权，失败不覆盖授权', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bd-auth-')), client = instance();
  client.binding = path.join(root, 'binding.json'); let account = 'account-a', fail = false;
  client.credentials = async () => ({ account, token: 'secret-token', device: 'secret-device' });
  client.member = async () => { if (fail) throw Error('offline'); return { connected: true }; };
  try {
    await assert.rejects(client.ensure()); await client.authorize(); assert.equal(await client.ensure(), account);
    const saved = await fs.readFile(client.binding, 'utf8'); assert.ok(!saved.includes('secret'));
    assert.equal((await fs.stat(client.binding)).mode & 0o777, 0o600);
    account = 'account-b'; await assert.rejects(client.ensure()); fail = true; await assert.rejects(client.authorize());
    assert.equal(await fs.readFile(client.binding, 'utf8'), saved);
  } finally { await fs.rm(root, { recursive: true }); }
});
test('已有本地目录可递归校验，符号链接及同名文件目录冲突拒绝', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bd-path-')), client = instance();
  client.paths = new Directories([{ id: 'media', label: 'media', browse: root, aria: root }]); client.own = async () => [{ server_filename: '01.mp4', isdir: 0 }];
  try {
    await fs.mkdir(path.join(root, 'season'));
    await client.validateTree([{ server_filename: 'season', path: '/season', isdir: 1 }], root, 'a');
    await fs.symlink('/tmp', path.join(root, 'escape'));
    await assert.rejects(client.validateTree([{ server_filename: 'escape', path: '/escape', isdir: 1 }], root, 'a'));
  } finally { await fs.rm(root, { recursive: true }); }
});
test('只提交选中的转存结果，飞牛路径独立，SDK 大 ID 正确关联进度', async () => {
  const client = instance(), calls = [];
  client.ensure = async () => 'a'; client.persist = async () => {}; client.shareParams = async () => ({ query: {}, spwd: 's' });
  client.shareList = async () => [{ fsid: 1, server_filename: 'other.mp4' }, { fsid: 2, server_filename: 'chosen.mp4' }];
  client.target = async () => ({ browse: '/downloads', sdk: '/vol3/Films' }); client.validateTree = async () => {};
  client.api = async (endpoint, query, body) => {
    calls.push({ endpoint, query, body });
    if (endpoint.endsWith('/transfer')) return { data: { task_id: 123 } };
    if (endpoint.endsWith('/taskquery')) return { data: { status: 'success', desc: { list: [{ from_fs_id: 2, to_fs_id: 20, to: '/cloud/chosen.mp4' }] } } };
    return { list: [{ fs_id: 20, task_id: '21792924462000002', path: '/cloud/chosen.mp4' }] };
  };
  const job = { account: 'a', download: true, target: {}, payload: { selectedIds: ['2'], parentId: '/', folderId: '/cloud' } };
  await client.run(job); assert.equal(job.state, 'downloading'); assert.equal(calls[0].body.fsid_list, '["2"]');
  assert.equal(calls[2].body.fs_ids, '[20]'); assert.equal(calls[2].body.save_path, '/vol3/Films'); assert.equal(job.files[0].gid, '21792924462000002');
  calls.length = 0; await client.run({ ...job, uncertain: true }); assert.equal(calls.length, 0);
});
