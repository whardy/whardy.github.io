#!/usr/bin/env python3
"""Offline Florida catalog checks, including source identity and media safety."""

import importlib.util
import json
import re
import unittest
from collections import Counter
from pathlib import Path
from zoneinfo import ZoneInfo
import datetime as dt

ROOT = Path(__file__).resolve().parents[1]
BUILDER = Path(__file__).with_name("build-catalog.py")
spec = importlib.util.spec_from_file_location("fl_builder", BUILDER)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class FloridaCatalogChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fl_path = ROOT.parents[1] / "sandbox/trip-camera-desk/data/FL.json"
        cls.fl = json.loads(cls.fl_path.read_text())
        cls.rows = cls.fl["cameras"]
        cls.index = json.loads((ROOT.parents[1] / "sandbox/trip-camera-desk/data/index.json").read_text())

    def test_trip_shard_and_derived_counts(self):
        state = next(s for s in self.index["states"] if s["state"] == "FL")
        self.assertEqual(state["views"], len(self.rows))
        self.assertEqual(state["locations"], len({c["siteId"] for c in self.rows}))
        self.assertEqual(state["withoutCoordinates"], sum(not c["hasCoordinates"] for c in self.rows))
        self.assertEqual(state["mediaCounts"], dict(Counter(c["mediaType"] for c in self.rows)))
        self.assertEqual(state["availabilityCounts"], dict(Counter(c["availability"] for c in self.rows)))
        self.assertIsNone(state["physicalDevicesVerified"])
        self.assertEqual(self.index["totals"]["views"], sum(s["views"] for s in self.index["states"]))

    def test_namespaces_and_original_source_ids(self):
        ids = [c["id"] for c in self.rows]
        self.assertEqual(len(ids), len(set(ids)))
        for camera in self.rows:
            self.assertRegex(camera["id"], r"^FL:[a-z0-9_-]+:[A-Za-z0-9_-]+$")
            self.assertEqual(camera["id"].split(":", 2)[2], camera["sourceId"])
            self.assertTrue(camera["siteId"].startswith("FL:"))
            self.assertIn(camera["providerSource"], builder.PROVIDERS)
            self.assertTrue(camera["provenance"])

    def test_media_urls_and_auth_are_safe(self):
        for camera in self.rows:
            self.assertRegex(camera["imageUrl"], r"^https://www\.fl511\.com/map/Cctv/\d+$")
            self.assertNotRegex(camera["imageUrl"], r"(?i)(?:token|secret|key|auth)=")
            self.assertFalse(camera["snapshotCacheBustAllowed"])
            self.assertEqual(camera["sourceCaptureTime"], None)
            if camera["videoAuthRequired"]:
                self.assertIsNone(camera["videoUrl"])
            if camera["videoUrl"]:
                self.assertEqual(camera["videoStatus"], "available")

    def test_missing_coordinates_stay_listed(self):
        sample = {"id": 900001, "source": "DIVAS-District 1", "roadway": "I-75",
                  "location": "Test view", "county": "Collier", "region": "Southwest",
                  "direction": "Northbound", "visible": True, "images": [{"id": 900002,
                  "cameraSiteId": 900001, "imageUrl": "/map/Cctv/900002",
                  "videoUrl": None, "isVideoAuthRequired": False}], "latLng": None}
        camera = builder.normalize_row(sample, "2026-11-04T00:00Z", {})[0]
        self.assertIsNone(camera["lat"])
        self.assertIsNone(camera["lon"])
        self.assertFalse(camera["hasCoordinates"])
        self.assertEqual(camera["id"], "FL:fdot-d1:900002")

    def test_directional_views_at_same_location_remain_distinct(self):
        base = {"id": 900001, "source": "DIVAS-District 1", "roadway": "I-75",
                "location": "Test view", "county": "Collier", "region": "Southwest",
                "direction": "Northbound", "visible": True,
                "latLng": {"geography": {"coordinateSystemId": 4326,
                           "wellKnownText": "POINT (-81.1 26.1)"}}}
        base["images"] = [{"id": 900002, "cameraSiteId": 900001, "imageUrl": "/map/Cctv/900002"},
                          {"id": 900003, "cameraSiteId": 900001, "imageUrl": "/map/Cctv/900003"}]
        views = builder.normalize_row(base, "2026-11-04T00:00Z", {})
        self.assertEqual(len(views), 2)
        self.assertNotEqual(views[0]["id"], views[1]["id"])
        self.assertEqual(views[0]["siteId"], views[1]["siteId"])

    def test_cross_provider_identity_reconciliation_retains_alias(self):
        a = {"id": "FL:fdot-d1:10", "providerKey": "fdot-d1", "sourceDirection": "Northbound",
             "imageUrl": "https://www.fl511.com/map/Cctv/10", "siteId": "FL:fdot-d1:site:10",
             "aliases": ["first"], "provenance": [{"source": "D1"}]}
        b = {"id": "FL:turnpike:20", "providerKey": "turnpike", "sourceDirection": "Northbound",
             "imageUrl": a["imageUrl"], "siteId": "FL:turnpike:site:20",
             "aliases": ["second"], "provenance": [{"source": "FTE"}]}
        merged, audit = builder.reconcile_exact_image_duplicates([a, b])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["aliasIds"], [b["id"]])
        self.assertEqual(len(merged[0]["provenance"]), 2)
        self.assertEqual(audit[0]["evidence"], "exact-image-url")
        b["sourceDirection"] = "Southbound"
        separate, _ = builder.reconcile_exact_image_duplicates([dict(a), b])
        self.assertEqual(len(separate), 2)

    def test_road_references_are_state_specific(self):
        self.assertEqual(builder.normalized_refs("I-4 / US-1 / SR 60 / CR 210"),
                         ["I-4", "US-1", "FL-60", "FL-CR-210"])
        self.assertEqual(builder.normalized_refs("Florida's Turnpike"), ["FL-TURNPIKE"])
        self.assertIn("FL-528", builder.normalized_refs("SR-528 / Beachline Expressway"))
        self.assertEqual(builder.normalized_refs("SR-A1A"), ["FL-A1A"])
        self.assertEqual(builder.normalized_refs("US-441"), ["US-441"])

    def test_toll_facility_uses_road_evidence(self):
        by_source = {c["sourceId"]: c for c in self.rows}
        self.assertIsNone(by_source["4011"]["tollFacility"])  # CFX crossing road
        self.assertEqual(builder.toll_facility({"source": "DIVAS-CFX", "roadway": "SR-417"}, "FL-417"), "FL-417")
        self.assertIsNone(builder.toll_facility({"source": "DIVAS-Turnpike SG C", "roadway": "Jog Road"}, "Jog Road"))
        self.assertEqual(builder.toll_facility({"source": "DIVAS-Turnpike SG C", "roadway": "Suncoast Parkway"}, "Suncoast Parkway"), "Suncoast Parkway")

    def test_eastern_and_central_daylight_saving(self):
        self.assertEqual(builder.timezone_for("Escambia", "1")[0], "America/Chicago")
        self.assertEqual(builder.timezone_for("Gulf", "3858")[0], "America/New_York")
        self.assertIsNone(builder.timezone_for("Gulf", "new-id")[0])
        sample = dt.datetime(2026, 7, 1, 12, tzinfo=dt.timezone.utc)
        self.assertEqual(sample.astimezone(ZoneInfo("America/Chicago")).hour, 7)
        self.assertEqual(sample.astimezone(ZoneInfo("America/New_York")).hour, 8)
        winter = dt.datetime(2026, 12, 1, 12, tzinfo=dt.timezone.utc)
        self.assertEqual(winter.astimezone(ZoneInfo("America/Chicago")).hour, 6)
        self.assertEqual(winter.astimezone(ZoneInfo("America/New_York")).hour, 7)

    def test_visual_offline_card_does_not_count_as_available(self):
        by_source = {c["sourceId"]: c for c in self.rows}
        self.assertEqual(by_source["3860"]["imageStatus"], "unavailable")
        self.assertEqual(by_source["3860"]["availability"], "unavailable")
        self.assertEqual(by_source["3972"]["imageStatus"], "available")
        self.assertEqual(by_source["4263"]["imageStatus"], "available")
        self.assertIsNone(by_source["3972"]["sourceCaptureTime"])

    def test_old_media_checks_become_stale(self):
        self.assertEqual(builder.media_check_status("available", "2026-10-20T04:27Z", "2026-11-04T04:27Z"), "stale")
        self.assertEqual(builder.media_check_status("unavailable", "2026-11-03T04:27Z", "2026-11-04T04:27Z"), "unavailable")


if __name__ == "__main__":
    unittest.main()
