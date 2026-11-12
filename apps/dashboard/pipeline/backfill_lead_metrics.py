#!/usr/bin/env python3
import glob
import json
import os

def backfill(conn, posts):
    filled = {'followers': 0, 'views': 0}
    for post in posts:
        for field, key in [('author_followers', 'followers'), ('views', 'views')]:
            value = post.get(field)
            if value is None: continue
            changed = conn.execute(f'UPDATE leads SET {field}=? WHERE post_id=? AND {field} IS NULL',
                                   (value, post['post_id'])).rowcount
            filled[key] += changed
    conn.commit()
    return filled

def main():
    import leads
    posts = []
    for path in sorted(glob.glob(os.path.join(leads.RAW_DIR, '*.json'))):
        posts.extend(leads.raw_posts([path]).values())
    conn = leads.connect()
    print(json.dumps(backfill(conn, posts)))
    conn.close()

if __name__ == '__main__': main()
