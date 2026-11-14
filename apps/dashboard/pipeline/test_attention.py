import json
import unittest
import attention

class AttentionTests(unittest.TestCase):
    def setUp(self):
        self.c = attention.connect(':memory:')
        self.item = dict(id='test:1', kind='task', label='Check import', preview_html='<p>One report</p>', report='Check the source.', source_links=[])
        attention.upsert(self.c, self.item)
        self.c.execute("UPDATE attention SET status_at='2026-01-01T00:00:00.000Z'")
        self.c.commit()

    def row(self):
        return dict(self.c.execute('SELECT * FROM attention').fetchone())

    def test_refresh_preserves_dismiss_and_pin(self):
        attention.change(self.c, 'test:1', 'dismissed', '2026-01-02T00:00:00.000Z')
        attention.upsert(self.c, {**self.item, 'report':'New evidence'})
        self.assertEqual(self.row()['status'], 'dismissed')
        attention.change(self.c, 'test:1', 'pinned', '2026-01-03T00:00:00.000Z')
        attention.upsert(self.c, self.item)
        self.assertEqual(self.row()['status'], 'pinned')

    def test_goal_requires_a_real_rewrite(self):
        attention.change(self.c, 'test:1', 'pinned', '2026-01-02T00:00:00.000Z')
        data=dict(goal_label='Check import', goal_report='Next: validate a stable build.', goal_preview_html='<progress value="25"></progress>', progress=25)
        with self.assertRaises(ValueError): attention.goal(self.c, 'test:1', data)
        attention.goal(self.c, 'test:1', {**data, 'goal_label':'Get imports working in stable'})
        self.assertEqual(self.row()['progress'], 25)
        self.assertIsNotNone(self.row()['last_tracked_at'])

    def test_wake_restores_pinned_and_keeps_tracking(self):
        attention.change(self.c, 'test:1', 'pinned', '2026-01-02T00:00:00.000Z')
        attention.change(self.c, 'test:1', 'snoozed', '2026-01-03T00:00:00.000Z', '2026-01-04T00:00:00.000Z')
        attention.wake(self.c)
        self.assertEqual(self.row()['status'], 'pinned')
        self.assertEqual(self.row()['pinned_at'], '2026-01-02T00:00:00.000Z')

    def test_new_dashboard_snapshot_roundtrips_idempotently(self):
        actions=[dict(id='test:new',status='pinned',at='2026-01-02 00:00:00.123',snooze_until='',snapshot=json.dumps({**self.item,'id':'test:new'}))]
        def ch(sql): return '1' if sql.startswith('EXISTS') else '\n'.join(map(json.dumps, actions))
        self.assertEqual(attention.apply_actions(self.c, ch), 1)
        self.assertEqual(attention.apply_actions(self.c, ch), 0)
        r = self.c.execute("SELECT * FROM attention WHERE id='test:new'").fetchone()
        self.assertEqual(r['status'], 'pinned')
        self.assertEqual(r['pinned_at'], '2026-01-02T00:00:00.123Z')

    def test_actions_do_not_undo_a_newer_done(self):
        attention.change(self.c, 'test:1', 'done', '2026-01-04T00:00:00.000Z')
        self.assertFalse(attention.change(self.c, 'test:1', 'open', '2026-01-02T00:00:00.000Z'))
        self.assertEqual(self.row()['status'], 'done')

    def test_labels_are_short(self):
        with self.assertRaises(ValueError): attention.upsert(self.c, {**self.item,'label':'x'*51})

    def test_unhold_history_is_not_a_new_task(self):
        self.c.execute('CREATE TABLE replies(id INTEGER,topic TEXT,note TEXT,target_url TEXT,requester TEXT,status TEXT)')
        self.c.execute("INSERT INTO replies VALUES(1,'Sync','hold before | recheck: UNHOLD kept','https://example.com','someone','drafted')")
        self.assertEqual(attention.refresh_holds(self.c), 0)

if __name__ == '__main__': unittest.main()
