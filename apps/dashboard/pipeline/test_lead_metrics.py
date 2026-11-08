import sqlite3
import unittest
from backfill_lead_metrics import backfill

class MetricTests(unittest.TestCase):
    def test_only_missing_metrics_are_filled_and_unknowns_stay_null(self):
        c=sqlite3.connect(':memory:')
        c.execute('CREATE TABLE leads(post_id TEXT,author_followers INTEGER,views INTEGER)')
        c.executemany('INSERT INTO leads VALUES(?,?,?)',[('a',None,None),('b',100,0),('c',None,None)])
        changed=backfill(c,[{'post_id':'a','author_followers':0,'views':25},{'post_id':'b','author_followers':500,'views':900},{'post_id':'c','views':None}])
        self.assertEqual(changed,{'followers':1,'views':1})
        self.assertEqual(c.execute('SELECT * FROM leads ORDER BY post_id').fetchall(), [('a',0,25),('b',100,0),('c',None,None)])
        self.assertEqual(backfill(c,[{'post_id':'a','author_followers':0,'views':25}]),{'followers':0,'views':0})

if __name__ == '__main__': unittest.main()
