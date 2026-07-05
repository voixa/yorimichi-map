#!/usr/bin/env python3
"""App Store Connect API でスクショを直接アップロード（ブラウザのファイルUL制約を回避）。
実行: ~/projects/yorimichi-map/.venv-shots/bin/python upload_screenshots_asc.py
"""
import time, json, hashlib, os, sys, glob
import jwt, requests

KEY_ID = "XZ54R7ZQ99"
ISSUER = "70cefba7-13f2-453a-907b-cb645079e635"
P8 = os.path.expanduser("~/.appstoreconnect/private_keys/AuthKey_XZ54R7ZQ99.p8")
APP_ID = "6782575046"
DISPLAY = "APP_IPHONE_65"   # 1284x2778 / 1242x2688 = 6.5"
SHOTS = sorted(glob.glob(os.path.expanduser("~/projects/yorimichi-map/ios-app/docs/app-store/screenshots/appstore-6.9/0*.png")))
BASE = "https://api.appstoreconnect.apple.com"

def token():
    with open(P8) as f:
        key = f.read()
    payload = {"iss": ISSUER, "iat": int(time.time()), "exp": int(time.time()) + 1000, "aud": "appstoreconnect-v1"}
    return jwt.encode(payload, key, algorithm="ES256", headers={"kid": KEY_ID, "typ": "JWT"})

H = {"Authorization": f"Bearer {token()}", "Content-Type": "application/json"}

def get(url, **params):
    r = requests.get(url if url.startswith("http") else BASE + url, headers=H, params=params or None)
    r.raise_for_status(); return r.json()

def post(path, body):
    r = requests.post(BASE + path, headers=H, data=json.dumps(body))
    if r.status_code >= 300: print("POST FAIL", path, r.status_code, r.text); r.raise_for_status()
    return r.json()

def patch(path, body):
    r = requests.patch(BASE + path, headers=H, data=json.dumps(body))
    if r.status_code >= 300: print("PATCH FAIL", path, r.status_code, r.text); r.raise_for_status()
    return r.json() if r.text else {}

# 1. editable iOS version — target 1.0.2 explicitly (avoid grabbing the live 1.0.1)
TARGET_VERSION = "1.0.2"
vers = get(f"/v1/apps/{APP_ID}/appStoreVersions",
           **{"filter[platform]": "IOS", "filter[versionString]": TARGET_VERSION})
if not vers["data"]:
    raise SystemExit(f"version {TARGET_VERSION} not found — create it first")
ver = vers["data"][0]
assert ver["attributes"]["appStoreState"] != "READY_FOR_SALE", "target is live; not editable"
ver_id = ver["id"]
print("version", ver["attributes"]["versionString"], ver["attributes"]["appStoreState"], ver_id)

# 2. localization ja
locs = get(f"/v1/appStoreVersions/{ver_id}/appStoreVersionLocalizations")
loc = next(l for l in locs["data"] if l["attributes"]["locale"].startswith("ja"))
loc_id = loc["id"]; print("locale", loc["attributes"]["locale"], loc_id)

# 3. screenshot set (find or create)
sets = get(f"/v1/appStoreVersionLocalizations/{loc_id}/appScreenshotSets")
sset = next((s for s in sets["data"] if s["attributes"]["screenshotDisplayType"] == DISPLAY), None)
if sset:
    set_id = sset["id"]; print("existing set", set_id)
else:
    body = {"data": {"type": "appScreenshotSets",
        "attributes": {"screenshotDisplayType": DISPLAY},
        "relationships": {"appStoreVersionLocalization": {"data": {"type": "appStoreVersionLocalizations", "id": loc_id}}}}}
    set_id = post("/v1/appScreenshotSets", body)["data"]["id"]; print("created set", set_id)

uploaded_ids = []
for path in SHOTS:
    data = open(path, "rb").read()
    name = os.path.basename(path)
    # reserve
    body = {"data": {"type": "appScreenshots",
        "attributes": {"fileSize": len(data), "fileName": name},
        "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": set_id}}}}}
    res = post("/v1/appScreenshots", body)["data"]
    sid = res["id"]
    ops = res["attributes"]["uploadOperations"]
    for op in ops:
        hdrs = {h["name"]: h["value"] for h in op["requestHeaders"]}
        chunk = data[op["offset"]:op["offset"] + op["length"]]
        pr = requests.request(op["method"], op["url"], headers=hdrs, data=chunk)
        pr.raise_for_status()
    # commit
    md5 = hashlib.md5(data).hexdigest()
    patch(f"/v1/appScreenshots/{sid}", {"data": {"type": "appScreenshots", "id": sid,
        "attributes": {"uploaded": True, "sourceFileChecksum": md5}}})
    uploaded_ids.append(sid)
    print("uploaded", name, sid)

# 4. set display order
order = {"data": [{"type": "appScreenshots", "id": i} for i in uploaded_ids]}
patch(f"/v1/appScreenshotSets/{set_id}/relationships/appScreenshots", order)
print("ordered", len(uploaded_ids), "screenshots -> set", set_id)
print("DONE")
