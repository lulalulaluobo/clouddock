#!/usr/bin/env python3
"""fnOS-only local adapter. Standard library; no tokens leave this process."""
import concurrent.futures
import hashlib
import hmac
import http.server
import json
import os
from pathlib import Path
import re
import socketserver
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


class PublicError(Exception):
    pass


def cloud_path(value):
    if not isinstance(value, str) or not value.startswith('/') or len(value) > 2048 or re.search(r'[\\\x00-\x1f]', value) or any(x in ('.', '..') for x in value.split('/')):
        raise PublicError('网盘目录无效，请重新选择')
    return '/' + '/'.join(x for x in value.split('/') if x)


def filename(value):
    if not isinstance(value, str) or not value or value in ('.', '..') or re.search(r'[/\\\x00-\x1f]', value) or len(value.encode()) > 240:
        raise PublicError('文件名包含不支持的字符或过长')
    return value


class Adapter:
    def __init__(self, config):
        self.config = config
        self.lock = threading.RLock()
        self.context = threading.local()
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        self.db = sqlite3.connect(config['state'], check_same_thread=False)
        self.db.execute('create table if not exists jobs (id text primary key, owner text, intent text, data text, unique(owner,intent))')
        self.db.commit()
        self.last_poll = 0

    def credentials(self):
        try:
            with sqlite3.connect('file:' + self.config['database'] + '?mode=ro', uri=True) as db:
                row = db.execute('select u.access_token,u.device_id,u.uk from nas_bd_user u join nas_bd_bind b on b.nas_uid=u.nas_uid and b.current_uk=u.uk where u.nas_uid=? and u.deleted_at=0 and b.deleted_at=0', (self.config['uid'],)).fetchone()
        except sqlite3.Error:
            raise PublicError('无法读取飞牛百度授权，请检查适配服务配置') from None
        if not row or not row[0] or not row[1]:
            raise PublicError('请先在飞牛官方百度网盘应用登录并绑定账号')
        return row

    def account(self):
        _, device, uk = self.credentials()
        return hashlib.sha256((str(uk) + ':' + device).encode()).hexdigest()

    def api(self, path, query, body=None):
        token, device, uk = self.credentials()
        expected = getattr(self.context, 'account', None)
        if expected and expected != hashlib.sha256((str(uk) + ':' + device).encode()).hexdigest():
            raise PublicError('飞牛百度账号已切换，本次任务已停止')
        query = dict(query, access_token=token)
        if query.get('device_id') is True:
            query['device_id'] = device
        req = urllib.request.Request('https://pan.baidu.com' + path + '?' + urllib.parse.urlencode(query), data=urllib.parse.urlencode(body).encode() if body is not None else None)
        try:
            try:
                response = urllib.request.urlopen(req, timeout=25)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                result = json.loads(response.read(8 * 1024 * 1024))
        except Exception:
            raise PublicError('百度请求结果未确认，请查看任务记录；勿重复提交') from None
        if result.get('errno') != 0:
            code = result.get('errno')
            if code in (110, 111, -6, 6):
                raise PublicError('百度授权已失效，请在飞牛官方百度网盘重新登录后检测')
            raise PublicError('百度未接受请求（代码 %s），请检查分享、提取码、容量或登录状态' % code)
        return result

    def health(self):
        result = self.api('/rest/2.0/xpan/device', {'method': 'iotqueryuinfo', 'device_id': True})
        data = result.get('data', {})
        return {'connected': True, 'engine': 'fnos-baidu', 'nasMember': data.get('is_iot_svip') == 1, 'expiresAt': data.get('end_time'), 'message': '已连接飞牛官方百度网盘；授权由飞牛应用管理'}

    def share_params(self, body):
        code = body.get('shareCode', '')
        if not isinstance(code, str) or not re.fullmatch(r'[A-Za-z0-9_-]{5,128}', code):
            raise PublicError('百度分享链接无效')
        # UI always passes the URL suffix including its initial 1.
        if not code.startswith('1'):
            raise PublicError('百度分享短链接格式无效')
        pwd = body.get('receiveCode', body.get('passcode', '')) or ''
        if not isinstance(pwd, str) or not re.fullmatch(r'[A-Za-z0-9]{0,16}', pwd):
            raise PublicError('提取码格式无效')
        query = {'appid': '116623829', 'product': 'netdisk', 'short_url': code[1:]}
        verified = self.api('/apaas/1.0/share/verify', query, {'pwd': pwd})
        return query, verified['data']['spwd']

    def share_list(self, query, spwd, parent):
        parent = cloud_path(parent)
        entries = []
        for page in range(1, 202):
            result = self.api('/apaas/1.0/share/list', query, {'spwd': spwd, 'dir': parent, 'page': page, 'page_size': 100, 'order_by': 'name', 'desc_order': 0})
            batch = result['data']['list']
            entries.extend(batch)
            if len(batch) < 100:
                return entries
        raise PublicError('目录过大，请缩小选择范围')

    def share(self, body):
        query, spwd = self.share_params(body)
        rows = self.share_list(query, spwd, body.get('parentId') or '/')
        return {'list': [{'fileId': cloud_path(x['path']) if x.get('isdir') else str(x.get('fsid', x.get('fs_id'))), 'fileIdToken': str(x.get('fsid', x.get('fs_id'))), 'fileName': filename(x['server_filename']), 'isFolder': bool(x.get('isdir')), 'fileSize': int(x.get('size', 0))} for x in rows], 'shareCode': body['shareCode']}

    def own(self, parent, folders=False):
        rows = []
        for start in range(0, 20100, 100):
            result = self.api('/rest/2.0/xpan/file', {'method': 'list', 'dir': cloud_path(parent), 'start': start, 'limit': 100, 'order': 'name', 'desc': 0})
            batch = result.get('list', [])
            rows.extend(batch)
            if len(batch) < 100:
                return [x for x in rows if not folders or x.get('isdir')]
        raise PublicError('目录过大，请缩小选择范围')

    def folders(self, body):
        return [{'cid': cloud_path(x['path']), 'name': filename(x['server_filename'])} for x in self.own(body.get('parentId') or '/', True)]

    def mkdir(self, body):
        parent = cloud_path(body.get('parentId') or '/')
        destination = parent.rstrip('/') + '/' + filename(body.get('name', '').strip())
        result = self.api('/rest/2.0/xpan/file', {'method': 'create'}, {'path': destination, 'isdir': 1, 'rtype': 0})
        return {'fid': result.get('path', destination)}

    def target(self, target):
        if not isinstance(target, dict):
            raise PublicError('请选择飞牛保存位置')
        root = next((r for r in self.config['roots'] if r['id'] == target.get('rootId')), None)
        relative = target.get('relativePath', '')
        if not root or not isinstance(relative, str) or relative.startswith('/') or re.search(r'[\\\x00-\x1f]', relative) or any(p in ('.', '..') for p in relative.split('/')):
            raise PublicError('飞牛保存路径不在允许范围')
        base = Path(root['host']).resolve(strict=True)
        candidate = base.joinpath(relative)
        current = base
        for part in Path(relative).parts:
            current = current / part
            if current.is_symlink():
                raise PublicError('飞牛目录不能包含符号链接')
        actual = candidate.resolve(strict=True)
        if not actual.is_dir() or not actual.is_relative_to(base):
            raise PublicError('飞牛目录不存在或越界')
        return actual, root['sdk'].rstrip('/') + ('/' + relative if relative else '')

    def persist(self, job):
        with self.lock:
            self.db.execute('insert or replace into jobs values (?,?,?,?)', (job['id'], job['owner'], job['intent'], json.dumps(job)))
            self.db.commit()

    @staticmethod
    def public(job):
        keys = ('id', 'title', 'state', 'phase', 'error', 'target', 'selectedCount', 'files', 'createdAt', 'provider', 'download')
        return {k: job[k] for k in keys}

    def jobs(self, owner):
        with self.lock:
            rows = self.db.execute('select data from jobs where owner=? order by rowid desc limit 30', (owner,)).fetchall()
        return [self.public(json.loads(r[0])) for r in rows]

    def create(self, owner, body):
        if not re.fullmatch(r'[\w-]{8,100}', str(body.get('intent', ''))):
            raise PublicError('操作标识无效，请重新打开转存窗口')
        selected = body.get('selectedIds')
        if not isinstance(selected, list) or not 1 <= len(selected) <= 500 or any(not isinstance(x, str) or not re.fullmatch(r'\d{1,20}', x) for x in selected) or len(set(selected)) != len(selected):
            raise PublicError('请明确勾选 1 至 500 个不同资源')
        payload = {'shareCode': body.get('shareCode'), 'passcode': body.get('passcode', ''), 'parentId': cloud_path(body.get('parentId') or '/'), 'folderId': cloud_path(body.get('folderId') or '/'), 'selectedIds': selected}
        with self.lock:
            row = self.db.execute('select data from jobs where owner=? and intent=?', (owner, body['intent'])).fetchone()
            if row:
                return self.public(json.loads(row[0]))
            active = self.db.execute("select count(*) from jobs where json_extract(data,'$.state') in ('queued','running')").fetchone()[0]
            if active >= 8:
                raise PublicError('转存队列已满，请稍后重试')
            if body.get('download', True):
                self.target(body.get('target'))
            job = {'id': 'baidu-' + str(uuid.uuid4()), 'owner': owner, 'intent': body['intent'], 'provider': 'baidu', 'account': self.account(), 'payload': payload, 'state': 'queued', 'phase': 'queued', 'error': '', 'title': str(body.get('title', '百度转存'))[:512], 'target': body.get('target') or {'relativePath': ''}, 'selectedCount': len(selected), 'files': [], 'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'download': body.get('download', True) is not False}
            self.persist(job)
            self.pool.submit(self.run, job)
            return self.public(job)

    def validate_download_tree(self, query, spwd, rows, base, depth=0, count=None):
        count = count if count is not None else [0]
        for row in rows:
            count[0] += 1
            if count[0] > 20000 or depth > 40:
                raise PublicError('资源过多，请分批选择')
            dest = base / filename(row['server_filename'])
            if dest.is_symlink() or dest.exists() and bool(row.get('isdir')) != dest.is_dir():
                raise PublicError('飞牛目标含符号链接或同名类型冲突，请更换保存路径')
            if row.get('isdir'):
                children = self.share_list(query, spwd, row['path']) if query is not None else self.own(row['path'])
                self.validate_download_tree(query, spwd, children, dest, depth + 1, count)

    def run(self, job):
        try:
            self.context.account = job['account']
            if job['account'] != self.account():
                raise PublicError('飞牛百度账号已切换，本次任务已停止，请重新选择资源')
            p = job['payload']
            if job.get('uncertain'):
                raise PublicError('上次提交结果未确认，为避免重复任务，请先在飞牛百度网盘核对结果')
            job.update(state='running', phase='validating'); self.persist(job)
            query, spwd = self.share_params(p)
            rows = self.share_list(query, spwd, p['parentId'])
            selected = [x for x in rows if str(x.get('fsid', x.get('fs_id'))) in p['selectedIds']]
            if len(selected) != len(p['selectedIds']):
                raise PublicError('勾选资源已变化，请重新选择')
            if job['download']:
                local, sdk = self.target(job['target'])
                self.validate_download_tree(query, spwd, selected, local)
            if not job.get('transferTask'):
                job.update(phase='saving', uncertain=True); self.persist(job)
                result = self.api('/apaas/1.0/share/transfer', dict(query, device_id=True), {'spwd': spwd, 'fsid_list': json.dumps(p['selectedIds']), 'to_path': p['folderId'], 'async': 2, 'ondup': 'newcopy'})
                job.update(transferTask=result['data']['task_id'], uncertain=False); self.persist(job)
            result = None
            for _ in range(120):
                result = self.api('/apaas/1.0/share/taskquery', {'appid': '116623829', 'task_id': job['transferTask']})['data']
                if result['status'] == 'success':
                    break
                if result['status'] not in ('pending', 'running'):
                    raise PublicError('百度转存失败，请查看云盘容量和分享状态')
                time.sleep(1)
            if result['status'] != 'success':
                raise PublicError('百度转存仍在处理，请在飞牛百度网盘核对本次结果，勿重复提交')
            saved = result['desc']['list']
            if len(saved) != len(selected) or set(str(x['from_fs_id']) for x in saved) != set(p['selectedIds']):
                raise PublicError('转存返回结果与勾选项不一致，已停止下载')
            job['saved'] = saved
            if not job['download']:
                job.update(state='completed', phase='completed'); self.persist(job); return
            # newcopy may rename a colliding directory. Validate the exact returned
            # subtree too, including links below that alternative local name.
            by_id = {str(x.get('fsid', x.get('fs_id'))): x for x in selected}
            actual_rows = [{**by_id[str(x['from_fs_id'])], 'path': cloud_path(x['to']), 'server_filename': x['to'].rsplit('/', 1)[-1]} for x in saved]
            self.validate_download_tree(None, None, actual_rows, local)
            if not job.get('downloadTasks'):
                ids = [x['to_fs_id'] for x in saved]
                job.update(phase='submitting', uncertain=True, rid=int(time.time()*1000)); self.persist(job)
                result = self.api('/rest/2.0/xpan/nas', {'method': 'download', 'device_id': True, 'type': 2, 'rtype': 1, 'rid': job['rid'], 'iot_version': 'FnOS-BaiduNetdisk-1.0.0', 'auto_sync': '0', 'use_local_mtime': '0'}, {'fs_ids': json.dumps(ids), 'save_path': sdk})
                tasks = result.get('list', [])
                job.update(downloadTasks=tasks, uncertain=False); self.persist(job)
                if len(tasks) != len(ids) or set(str(x.get('fs_id')) for x in tasks) != set(map(str, ids)):
                    raise PublicError('部分下载结果未确认，请在飞牛百度网盘检查，勿重复提交')
            job['files'] = [{'gid': str(x['task_id']), 'fid': str(x['fs_id']), 'path': x['path'].rsplit('/', 1)[-1], 'state': 'waiting', 'completed': 0, 'total': 0, 'speed': 0} for x in job['downloadTasks']]
            job.update(state='downloading', phase='downloading'); self.persist(job)
        except PublicError as error:
            job.update(state='failed', error=str(error)); self.persist(job)
        except Exception:
            job.update(state='failed', error='处理结果未确认，请在飞牛百度网盘核对本次任务'); self.persist(job)
        finally:
            self.context.account = None

    def refresh(self):
        with self.lock:
            rows = [json.loads(r[0]) for r in self.db.execute("select data from jobs where json_extract(data,'$.state')='downloading'")]
        if not rows:
            return
        account = self.account()
        ids = list({int(f['gid']) for job in rows if job['account'] == account for f in job['files']})
        tasks = {}
        for start in range(0, len(ids), 100):
            result = self.api('/rest/2.0/xpan/nas', {'method': 'batchtaskmeta', 'device_id': True, 'taskid_list': json.dumps(ids[start:start+100]), 'iot_version': 'FnOS-BaiduNetdisk-1.0.0'})
            tasks.update({str(x['task_id']): x for x in result.get('task_meta', [])})
        for job in rows:
            if job['account'] != account:
                job.update(state='failed', error='飞牛百度账号已切换，请在原账号查看下载结果'); self.persist(job); continue
            for file in job['files']:
                row = tasks.get(file['gid'])
                if not row:
                    continue  # Do not assume a missing page means completion/failure.
                file.update(state='complete' if row['status'] == 5 else 'error' if row.get('fail_code') else 'active' if row['status'] == 3 else 'waiting', completed=int(row.get('current_size', 0)), total=int(row.get('size', 0)), speed=int(row.get('speed', 0)) if row['status'] == 3 else 0)
                if file['state'] == 'error':
                    file['error'] = '飞牛百度下载失败（代码 %s）' % row['fail_code']
            if job['files'] and all(x['state'] == 'complete' for x in job['files']):
                job.update(state='completed', phase='completed')
            elif any(x['state'] == 'error' for x in job['files']):
                job.update(state='failed', error='请在飞牛官方百度网盘查看或恢复失败下载')
            self.persist(job)

    def recover(self):
        with self.lock:
            jobs = [json.loads(r[0]) for r in self.db.execute("select data from jobs where json_extract(data,'$.state') in ('queued','running')")]
        for job in jobs:
            self.pool.submit(self.run, job)


def serve(config):
    adapter = Adapter(config)
    key = Path(config['keyFile']).read_text().strip()
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            status = 200
            try:
                if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + key):
                    status = 403
                    raise PublicError('适配服务配对码不正确，请重新连接')
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 262144:
                    raise PublicError('请求大小无效')
                body = json.loads(self.rfile.read(size))
                owner = body.pop('_owner', '')
                if not isinstance(owner, str) or not 1 <= len(owner) <= 128:
                    raise PublicError('CloudDock 用户标识无效')
                action = self.path
                if action == '/health': data = adapter.health()
                elif action == '/share': data = adapter.share(body)
                elif action == '/folders': data = adapter.folders(body)
                elif action == '/mkdir': data = adapter.mkdir(body)
                elif action == '/jobs': data = adapter.create(owner, body)
                elif action == '/list': data = adapter.jobs(owner)
                else: raise PublicError('接口不存在')
                result = {'success': True, 'data': data}
            except PublicError as error:
                result = {'success': False, 'message': str(error)}
            except Exception:
                result = {'success': False, 'message': '飞牛百度适配服务请求失败，请检查配置'}
            payload = json.dumps(result, ensure_ascii=False).encode()
            self.send_response(status); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload)

    class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
        daemon_threads = True
    socket = Path(config['socket'])
    socket.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if socket.exists(): socket.unlink()
    server = Server(str(socket), Handler)
    os.chmod(socket, 0o600)
    def monitor():
        while True:
            try: adapter.refresh()
            except Exception: pass
            time.sleep(5)
    adapter.recover()
    threading.Thread(target=monitor, daemon=True).start()
    server.serve_forever()


if __name__ == '__main__':
    import sys
    os.umask(0o077)
    serve(json.loads(Path(sys.argv[1]).read_text()))
