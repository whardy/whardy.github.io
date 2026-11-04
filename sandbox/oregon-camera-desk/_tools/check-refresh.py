#!/usr/bin/env python3
"""Offline regression checks for source interpretation and last-good protection."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('oregon_refresh',Path(__file__).with_name('refresh-catalog.py'))
refresh=importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)

class SourceInterpretation(unittest.TestCase):
    def test_street_quadrants_are_not_view_directions(self):
        self.assertEqual(refresh.viewing_direction('Bend NW Arizona Ave at NW Bond St','Bend NW Arizona Ave at NW Bond St_pid4754.jpg'),'')
        self.assertEqual(refresh.viewing_direction('I-405 at SW Alder','I-405 at SW Alder NB_pid4797.jpg'),'NB')
        self.assertEqual(refresh.viewing_direction('NW Murray at US26 EB','NW Murray at US26 EB_pid4746.jpg'),'EB')
        self.assertEqual(refresh.viewing_direction('Portland - SE Grand Ave at SE Madison St','SE Grand Ave SE Madison_pid1.jpg'),'')
        self.assertEqual(refresh.viewing_direction('Idaho - US95 at Ion Summit NW','US95 at Ion Summit NW_pid4261.jpg'),'NW')
        self.assertEqual(refresh.viewing_direction('Camera at street','Camera facing SE_pid2.jpg'),'SE')
        self.assertEqual(refresh.viewing_direction('NW camera','camera SB_pid2.jpg'),'SB')

    def test_transport_failures_and_notices_are_distinct(self):
        dns={'httpStatus':None,'sourceImageStatus':'unavailable','error':'Name or service not known'}
        timeout={'httpStatus':None,'sourceImageStatus':'unavailable','error':'timed out'}
        notice={'httpStatus':200,'sourceImageStatus':'unavailable','isPlaceholder':True}
        good={'httpStatus':200,'sourceImageStatus':'available'}
        self.assertTrue(refresh.has_widespread_audit_failure([dns,timeout]))
        self.assertTrue(refresh.has_widespread_audit_failure([dns]*9+[good]))
        self.assertFalse(refresh.has_widespread_audit_failure([notice]*10))
        self.assertFalse(refresh.has_widespread_audit_failure([dns]+[good]*9))

    def test_all_dns_failures_preserve_catalog_and_audit_bytes(self):
        with tempfile.TemporaryDirectory() as td:
            out=Path(td)/'dist';out.mkdir()
            old_catalog={'fetchedAt':'2026-01-01T00:00:00Z','cameras':[{'id':'533','siteId':'tripcheck-camera-103','imageStatus':'available','imageUrl':'https://www.tripcheck.com/roadcams/cams/example_pid533.jpg'}]}
            catalog_path=out/'camera-catalog.json';catalog_path.write_text(json.dumps(old_catalog))
            audit_path=out/'source-audit.json';audit_path.write_text('{"checks":[],"completedAt":"original audit"}')
            before_catalog=catalog_path.read_bytes();before_audit=audit_path.read_bytes()
            result={'id':'533','httpStatus':None,'sourceImageStatus':'unavailable','error':'DNS resolution failed'}
            argv=['refresh-catalog.py','--audit-only','--output',str(out),'--cache-dir',str(Path(td)/'cache')]
            with patch.object(sys,'argv',argv),patch.object(refresh,'audit_one',return_value=result):
                with self.assertRaisesRegex(ValueError,'preserving last known-good'):
                    refresh.main()
            self.assertEqual(catalog_path.read_bytes(),before_catalog)
            self.assertEqual(audit_path.read_bytes(),before_audit)
            self.assertTrue((Path(td)/'cache/last-failed-audit.json').exists())

if __name__=='__main__':unittest.main()
