#!/usr/bin/env python3
import argparse
import datetime as dt
import html
import json
import os
import re
import sqlite3
import sys
import subprocess

STATUSES = ('open', 'pinned', 'done', 'dismissed', 'snoozed')

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def connect(path=None):
    c = sqlite3.connect(path or os.getenv('ARDIA_DB_PATH', '/workspace/ardia-db/ardia.db'))
    c.row_factory = sqlite3.Row
    ensure(c)
    return c

def ensure(c):
    c.execute('''CREATE TABLE IF NOT EXISTS attention (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open','pinned','done','dismissed','snoozed')),
      resume_status TEXT NOT NULL DEFAULT 'open', snooze_until TEXT,
      label TEXT NOT NULL CHECK(length(label)<=50), preview_html TEXT NOT NULL, report TEXT NOT NULL,
      goal_label TEXT CHECK(length(goal_label)<=50), goal_preview_html TEXT, goal_report TEXT,
      last_tracked_at TEXT, progress REAL CHECK(progress IS NULL OR (progress>=0 AND progress<=100)),
      source_links TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      status_at TEXT NOT NULL, pinned_at TEXT)''')
    c.commit()

def label(value):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 50 or '\n' in value:
        raise ValueError('Labels must be one plain line, 1–50 characters')
    return value.strip()

def upsert(c, item):
    stamp = now()
    if not re.fullmatch(r'[\w:./-]{1,240}', item.get('id', '')):
        raise ValueError('Invalid stable id')
    links = item.get('source_links', [])
    if isinstance(links, str): links = json.loads(links)
    if not isinstance(links, list): raise ValueError('source_links must be a list')
    values = (item['id'], item.get('kind', 'task'), label(item['label']), item['preview_html'],
              item['report'], json.dumps(links), stamp, stamp, stamp)
    c.execute('''INSERT INTO attention(id,kind,label,preview_html,report,source_links,created_at,updated_at,status_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,label=excluded.label,
      preview_html=excluded.preview_html,report=excluded.report,source_links=excluded.source_links,
      updated_at=excluded.updated_at''', values)
    c.commit()

def change(c, ident, status, at=None, until=None):
    if status not in STATUSES: raise ValueError('Unknown status')
    row = c.execute('SELECT * FROM attention WHERE id=?', (ident,)).fetchone()
    if row is None: raise ValueError('No such item')
    stamp = at or now()
    if stamp <= row['status_at']: return False
    resume = row['resume_status'] if row['status'] == 'snoozed' else row['status']
    if resume not in ('open', 'pinned'): resume = 'open'
    if status == 'snoozed' and not until: raise ValueError('Snooze needs an end time')
    c.execute('''UPDATE attention SET status=?,resume_status=?,snooze_until=?,status_at=?,updated_at=?,
      pinned_at=CASE WHEN ?='pinned' AND status!='pinned' AND NOT(status='snoozed' AND resume_status='pinned') THEN ? ELSE pinned_at END WHERE id=?''',
      (status, resume, until if status == 'snoozed' else None, stamp, stamp, status, stamp, ident))
    c.commit()
    return True

def wake(c):
    stamp = now()
    rows = c.execute("SELECT * FROM attention WHERE status='snoozed' AND snooze_until<=?", (stamp,)).fetchall()
    for r in rows:
        c.execute('UPDATE attention SET status=resume_status,snooze_until=NULL,status_at=?,updated_at=? WHERE id=?',
                  (stamp, stamp, r['id']))
    c.commit()
    return len(rows)

def goal(c, ident, data):
    row = c.execute('SELECT * FROM attention WHERE id=?', (ident,)).fetchone()
    if not row or row['status'] != 'pinned': raise ValueError('Only pinned items are goals')
    title = label(data['goal_label'])
    if title.casefold() == row['label'].casefold(): raise ValueError('Rewrite the label as an outcome, not the issue title')
    if data['goal_report'].strip() == row['report'].strip(): raise ValueError('Rewrite the report for tracking')
    p = data.get('progress')
    if p is not None and not 0 <= float(p) <= 100: raise ValueError('progress must be 0–100 or null')
    stamp = now()
    c.execute('''UPDATE attention SET goal_label=?,goal_preview_html=?,goal_report=?,progress=?,
      last_tracked_at=?,updated_at=? WHERE id=?''', (title, data['goal_preview_html'], data['goal_report'], p, stamp, stamp, ident))
    c.commit()

def apply_actions(c, ch, database='sandbox'):
    if ch(f'EXISTS TABLE {database}.ardia_attention_actions').strip() != '1': return 0
    rows = ch(f'''SELECT id,status,toString(at) AS at,snooze_until,snapshot
      FROM {database}.ardia_attention_actions ORDER BY at,id FORMAT JSONEachRow''')
    n = 0
    for line in rows.splitlines():
        if not line.strip(): continue
        a = json.loads(line)
        if not c.execute('SELECT 1 FROM attention WHERE id=?', (a['id'],)).fetchone():
            source = json.loads(a['snapshot'])
            source['id'] = a['id']
            upsert(c, source)
            c.execute("UPDATE attention SET status_at='1970-01-01T00:00:00.000Z' WHERE id=?", (a['id'],))
        at = dt.datetime.fromisoformat(a['at'].replace('Z', '+00:00'))
        if at.tzinfo is None: at = at.replace(tzinfo=dt.timezone.utc)
        stamp = at.astimezone(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        n += change(c, a['id'], a['status'], stamp, a.get('snooze_until') or None)
    return n

def visual(chip, heading, detail):
    return f'<span class="chip">{html.escape(chip)}</span><h2>{html.escape(heading)}</h2><p>{html.escape(detail)}</p>'

def refresh_holds(c):
    n = 0
    for r in c.execute("SELECT id,topic,note,target_url,requester FROM replies WHERE status='drafted'").fetchall():
        note = r['note'] or ''
        last = re.split(r'\||; recheck|recheck 20', note, flags=re.I)[-1]
        held = bool(re.search(r'\b(?:keep hold|kept hold|hold kept|still (?:on )?hold)\b', last, re.I))
        ident = f'hold:reply-{r["id"]}'
        if not held: continue
        suffix = f' (#{r["id"]})'
        title = label(('Verify ' + (r['topic'] or 'held reply'))[:50-len(suffix)] + suffix)
        old = c.execute('SELECT label FROM attention WHERE id=?', (ident,)).fetchone()
        if old: title = old['label']
        detail = last.split('—', 1)[-1].strip()[:500]
        upsert(c, dict(id=ident, kind='reply-hold', label=title,
          preview_html=visual('Reply on hold', r['topic'] or 'Check the fix', 'Verify before saying it is fixed.'),
          report=f'What needs you\nThis reply is on hold.\n\nLatest saved pipeline check (may be old)\n{detail}\n\nNext step\nCheck the source and the latest release. Keep the reply as a draft until the claim is true.',
          source_links=[{'label': 'Original report', 'url': r['target_url']}] if r['target_url'] else []))
        n += 1
    return n

def refresh_reviews(c):
    result = subprocess.run(['gh', 'pr', 'list', '-R', 'mantrakp04/ardia', '--state', 'open', '--limit', '1000',
      '--json', 'number,title,url,isDraft,author'], check=True, capture_output=True, text=True)
    rows = [r for r in json.loads(result.stdout) if not r['isDraft'] and r['author'].get('login') != 'mantrakp04']
    n = len(rows)
    if not n: return 0
    upsert(c, dict(id='review:outside-prs', kind='review', label=f'Review {n} outside pull requests',
      preview_html=f'<span class="chip">Review backlog</span><h2>{n} open PRs</h2><p>From contributors and bots. Check the demo, comments and tests before merging.</p>',
      report=f'{n} open, non-draft pull requests from contributors and bots. This does not mean they are ready to merge.\n\nNext step\nPick a PR. Check the demo, unanswered review comments, linked issue and tests. Native changes still need a Mac check.\n\nOpen PRs\n' +
        '\n'.join(f'#{r["number"]} · {r["title"]}' for r in rows),
      source_links=[{'label': f'PR #{r["number"]}', 'url': r['url']} for r in rows]))
    return n

def read_json(path):
    if path == '-': return json.load(sys.stdin)
    with open(path) as f: return json.load(f)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db', help='SQLite path (default ARDIA_DB_PATH or /workspace/ardia-db/ardia.db)')
    sub = p.add_subparsers(dest='command', required=True)
    sub.add_parser('init')
    sub.add_parser('wake')
    sub.add_parser('pull-actions')
    q = sub.add_parser('refresh', help='Refresh explicit held replies from the latest local evidence')
    q.add_argument('--github', action='store_true', help='Also refresh the open contributor PR backlog with gh')
    q = sub.add_parser('list'); q.add_argument('--status', choices=STATUSES)
    sub.add_parser('needs-write', help='Open tasks and pinned goals, with evidence to refresh')
    sub.add_parser('newly-pinned', help='Pinned goals not rewritten since pinning')
    q = sub.add_parser('upsert'); q.add_argument('file', help='JSON item/list or - for stdin')
    q = sub.add_parser('goal'); q.add_argument('id'); q.add_argument('file', help='JSON goal fields')
    q = sub.add_parser('done'); q.add_argument('id'); q.add_argument('--evidence', required=True)
    a = p.parse_args(); c = connect(a.db); out = None
    if a.command == 'wake': out = {'woken': wake(c)}
    elif a.command == 'pull-actions':
        import ch_sync
        out = {'applied': apply_actions(c, ch_sync.ch, ch_sync.CH_DB)}
    elif a.command == 'refresh':
        out = {'refreshed_holds': refresh_holds(c), 'woken': wake(c)}
        if a.github: out['outside_prs'] = refresh_reviews(c)
    elif a.command == 'goal': goal(c, a.id, read_json(a.file)); out = {'updated': a.id}
    elif a.command == 'upsert':
        data = read_json(a.file)
        for item in data if isinstance(data, list) else [data]: upsert(c, item)
    elif a.command == 'done':
        r = c.execute('SELECT report FROM attention WHERE id=?', (a.id,)).fetchone()
        if not r: raise ValueError('No such item')
        c.execute('UPDATE attention SET report=report || ? WHERE id=?', ('\n\nDone\n' + a.evidence, a.id)); c.commit()
        change(c, a.id, 'done')
    elif a.command in ('list', 'needs-write', 'newly-pinned'):
        where = ''
        if a.command == 'list' and a.status: where = ' WHERE status=' + "'" + a.status + "'"
        if a.command == 'needs-write': where = " WHERE status IN ('open','pinned')"
        if a.command == 'newly-pinned': where = " WHERE status='pinned' AND (goal_label IS NULL OR last_tracked_at IS NULL OR last_tracked_at<pinned_at)"
        out = [dict(r) for r in c.execute('SELECT * FROM attention' + where + ' ORDER BY created_at,id')]
    if out is not None: print(json.dumps(out, ensure_ascii=False, indent=2))
    c.close()

if __name__ == '__main__': main()
