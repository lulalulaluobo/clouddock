import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('bridge', Path(__file__).resolve().parents[1] / 'bridge/baidu.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class Fake(bridge.Adapter):
    def __init__(self, directory):
        super().__init__({'state': str(directory / 'jobs.db'), 'roots': [{'id': 'media', 'host': str(directory), 'sdk': '/vol3/media'}]})
        self.calls = []
        self.change_account = False
        self.fail_download = False
        self.complete = False
    def credentials(self):
        return 'private-token', 'device', 'different' if self.change_account else 'account'
    def api(self, path, query, body=None):
        self.calls.append((path, query, body))
        if path.endswith('/verify'): return {'data': {'spwd': 'private-share-token'}}
        if path.endswith('/list'): return {'data': {'list': [{'fsid': '11', 'path': '/a.mp4', 'server_filename': 'a.mp4', 'size': 10, 'isdir': 0}, {'fsid': '22', 'path': '/b.mp4', 'server_filename': 'b.mp4', 'size': 20, 'isdir': 0}]}}
        if path.endswith('/transfer'): return {'data': {'task_id': 'transfer1'}}
        if path.endswith('/taskquery'): return {'data': {'status': 'success', 'desc': {'list': [{'from_fs_id': 22, 'to_fs_id': 222, 'to': '/cloud/b.mp4'}]}}}
        if query.get('method') == 'download':
            if self.fail_download: raise bridge.PublicError('结果未确认')
            return {'list': [{'fs_id': 222, 'task_id': 999, 'path': '/cloud/b.mp4'}]}
        if query.get('method') == 'batchtaskmeta': return {'task_meta': [{'task_id': 999, 'status': 5 if self.complete else 3, 'size': 20, 'current_size': 20 if self.complete else 10, 'speed': 10, 'fail_code': 0}]}
        raise AssertionError((path, query))


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.a = Fake(self.root)
        self.body = {'shareCode': '1abcd_test', 'passcode': 'test', 'selectedIds': ['22'], 'folderId': '/cloud', 'parentId': '/', 'intent': 'test-intent-111', 'target': {'rootId': 'media', 'relativePath': ''}, 'title': 'test'}
        # deterministic worker execution; persist/restart behavior remains real SQLite.
        self.a.pool.shutdown()
        self.a.pool = type('Queue', (), {'submit': lambda _, *args: None})()
    def tearDown(self):
        self.a.db.close(); self.temp.cleanup()
    def job(self):
        self.a.create('owner1', self.body)
        return json.loads(self.a.db.execute('select data from jobs').fetchone()[0])
    def test_selected_only_and_target_mapping(self):
        job = self.job(); self.a.run(job)
        transfers = [x for x in self.a.calls if x[0].endswith('/transfer')]
        self.assertEqual(json.loads(transfers[0][2]['fsid_list']), ['22'])
        downloads = [x for x in self.a.calls if x[1].get('method') == 'download']
        self.assertEqual(json.loads(downloads[0][2]['fs_ids']), [222])
        self.assertEqual(downloads[0][2]['save_path'], '/vol3/media')
        self.assertEqual(job['files'][0]['path'], 'b.mp4')
    def test_idempotency_and_owner_isolation(self):
        one = self.a.create('owner1', self.body)
        self.assertEqual(one['id'], self.a.create('owner1', self.body)['id'])
        self.assertEqual(self.a.jobs('other'), [])
        self.assertNotIn('payload', one)
        self.assertNotIn('private-token', json.dumps(one))
    def test_cloud_only_never_submits_download(self):
        self.body.update(download=False, target=None)
        job = self.job(); self.a.run(job)
        self.assertEqual(job['state'], 'completed')
        self.assertFalse(any(x[1].get('method') == 'download' for x in self.a.calls))
    def test_missing_selected_rejected_before_transfer(self):
        self.body['selectedIds'] = ['33']
        job = self.job(); self.a.run(job)
        self.assertEqual(job['state'], 'failed')
        self.assertFalse(any(x[0].endswith('/transfer') for x in self.a.calls))
    def test_account_change_prevents_submission(self):
        job = self.job(); self.a.change_account = True; self.a.run(job)
        self.assertEqual(job['state'], 'failed'); self.assertEqual(self.a.calls, [])
    def test_uncertain_download_never_replayed(self):
        job = self.job(); self.a.fail_download = True; self.a.run(job)
        self.assertTrue(job['uncertain'])
        before = len(self.a.calls); self.a.run(job)
        self.assertEqual(before, len(self.a.calls))
    def test_known_transfer_checkpoint_not_resubmitted(self):
        job = self.job(); job['transferTask'] = 'transfer1'; self.a.run(job)
        self.assertFalse(any(x[0].endswith('/transfer') for x in self.a.calls))
    def test_progress_uses_native_task_identity(self):
        job = self.job(); self.a.run(job); self.a.refresh()
        self.assertEqual(self.a.jobs('owner1')[0]['files'][0]['completed'], 10)
        self.a.complete = True; self.a.refresh()
        self.assertEqual(self.a.jobs('owner1')[0]['state'], 'completed')
    def test_path_traversal_and_symlinks(self):
        for value in ['../bad', '/etc', 'a/../b', 'a\\b']:
            with self.assertRaises(bridge.PublicError): self.a.target({'rootId': 'media', 'relativePath': value})
        (self.root / 'link').symlink_to('/tmp')
        with self.assertRaises(bridge.PublicError): self.a.target({'rootId': 'media', 'relativePath': 'link'})
        (self.root / 'b.mp4').symlink_to('/tmp/outside')
        job = self.job(); self.a.run(job)
        self.assertEqual(job['state'], 'failed')
        self.assertFalse(any(x[0].endswith('/transfer') for x in self.a.calls))
    def test_empty_duplicate_selection_rejected(self):
        for selection in [[], ['22', '22'], ['../evil']]:
            self.body['selectedIds'] = selection
            with self.assertRaises(bridge.PublicError): self.a.create('owner1', self.body)


if __name__ == '__main__': unittest.main()
