#!/usr/bin/env python3
"""App Store Connect: yorimichi v1.0.1(build4) の提出フロー。
実行: ~/projects/yorimichi-map/.venv-shots/bin/python asc_submit.py <cmd>
  cmd: status | prep | wait | attach | submit | all
"""
import sys, time, json, os
import jwt, requests

KID = "XZ54R7ZQ99"
ISS = "70cefba7-13f2-453a-907b-cb645079e635"
P8 = os.path.expanduser("~/.appstoreconnect/private_keys/AuthKey_XZ54R7ZQ99.p8")
APP_ID = "6782575046"
VERSION = "1.0.2"
BUILD_NO = "5"
BASE = "https://api.appstoreconnect.apple.com"

WHATS_NEW = (
    "細かな不具合を修正し、動作の安定性を改善しました。\n"
    "これからも、寄り道がもっと楽しくなるよう改善を続けます。"
)

def token():
    now = int(time.time())
    with open(P8) as f:
        key = f.read()
    return jwt.encode({"iss": ISS, "iat": now, "exp": now + 1200, "aud": "appstoreconnect-v1"},
                      key, algorithm="ES256", headers={"kid": KID, "typ": "JWT"})

def H():
    return {"Authorization": f"Bearer {token()}", "Content-Type": "application/json"}

def req(method, path, body=None, **params):
    r = requests.request(method, BASE + path, headers=H(),
                         data=json.dumps(body) if body else None, params=params or None)
    try:
        j = r.json() if r.text else {}
    except Exception:
        j = {"raw": r.text}
    return r.status_code, j

def get(p, **kw): return req("GET", p, None, **kw)
def post(p, b):   return req("POST", p, b)
def patch(p, b):  return req("PATCH", p, b)

def find_version():
    sc, j = get(f"/v1/apps/{APP_ID}/appStoreVersions",
                **{"filter[versionString]": VERSION, "filter[platform]": "IOS"})
    data = j.get("data", [])
    return data[0] if data else None

def ensure_version():
    v = find_version()
    if v:
        return v
    sc, j = post("/v1/appStoreVersions", {
        "data": {"type": "appStoreVersions",
                 "attributes": {"platform": "IOS", "versionString": VERSION},
                 "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}}}})
    print("create version:", sc)
    if sc >= 300:
        print(json.dumps(j, ensure_ascii=False, indent=2)); sys.exit(1)
    return j["data"]

def set_whats_new(vid):
    sc, j = get(f"/v1/appStoreVersions/{vid}/appStoreVersionLocalizations")
    locs = j.get("data", [])
    for loc in locs:
        lid = loc["id"]; lc = loc["attributes"]["locale"]
        sc2, j2 = patch(f"/v1/appStoreVersionLocalizations/{lid}",
                        {"data": {"type": "appStoreVersionLocalizations", "id": lid,
                                  "attributes": {"whatsNew": WHATS_NEW}}})
        print(f"  whatsNew [{lc}]: {sc2}")

def find_build():
    sc, j = get("/v1/builds",
                **{"filter[app]": APP_ID, "filter[version]": BUILD_NO, "limit": 5,
                   "sort": "-uploadedDate"})
    data = j.get("data", [])
    return data[0] if data else None

def status():
    v = find_version()
    if v:
        a = v["attributes"]
        print(f"version {VERSION}: id={v['id']} state={a.get('appStoreState')}")
    else:
        print(f"version {VERSION}: (not created yet)")
    b = find_build()
    if b:
        a = b["attributes"]
        print(f"build {BUILD_NO}: id={b['id']} processing={a.get('processingState')} expired={a.get('expired')}")
    else:
        print(f"build {BUILD_NO}: (not visible yet / still processing on Apple side)")

def wait_build(max_min=25):
    print(f"waiting for build {BUILD_NO} to process (up to {max_min}min)...")
    for i in range(max_min * 3):
        b = find_build()
        if b:
            ps = b["attributes"].get("processingState")
            print(f"  [{i}] build {BUILD_NO} processing={ps}")
            if ps == "VALID":
                return b
            if ps == "INVALID":
                print("BUILD INVALID"); sys.exit(1)
        else:
            print(f"  [{i}] build not visible yet")
        time.sleep(20)
    print("timeout waiting for build"); sys.exit(1)

def attach(vid, bid):
    sc, j = patch(f"/v1/appStoreVersions/{vid}/relationships/build",
                  {"data": {"type": "builds", "id": bid}})
    print("attach build:", sc)
    if sc >= 300:
        print(json.dumps(j, ensure_ascii=False, indent=2))
    return sc < 300

def submit(vid):
    # newer flow: reviewSubmission + item + submitted:true
    sc, j = post("/v1/reviewSubmissions",
                 {"data": {"type": "reviewSubmissions",
                           "attributes": {"platform": "IOS"},
                           "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}}}})
    if sc >= 300:
        print("create reviewSubmission:", sc); print(json.dumps(j, ensure_ascii=False, indent=2)); return False
    rsid = j["data"]["id"]
    print("reviewSubmission:", rsid)
    sc, j = post("/v1/reviewSubmissionItems",
                 {"data": {"type": "reviewSubmissionItems",
                           "relationships": {
                               "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": rsid}},
                               "appStoreVersion": {"data": {"type": "appStoreVersions", "id": vid}}}}})
    print("add item:", sc)
    if sc >= 300:
        print(json.dumps(j, ensure_ascii=False, indent=2)); return False
    sc, j = patch(f"/v1/reviewSubmissions/{rsid}",
                  {"data": {"type": "reviewSubmissions", "id": rsid,
                            "attributes": {"submitted": True}}})
    print("submit:", sc)
    if sc >= 300:
        print(json.dumps(j, ensure_ascii=False, indent=2)); return False
    print("SUBMITTED for review ✅")
    return True

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "status":
        status()
    elif cmd == "prep":
        v = ensure_version(); print("version id:", v["id"], "state:", v["attributes"].get("appStoreState"))
        set_whats_new(v["id"])
    elif cmd == "wait":
        wait_build()
    elif cmd == "attach":
        v = ensure_version(); b = find_build()
        if not b: print("build not ready"); sys.exit(1)
        attach(v["id"], b["id"])
    elif cmd == "submit":
        v = ensure_version(); submit(v["id"])
    elif cmd == "all":
        v = ensure_version(); print("version:", v["id"], v["attributes"].get("appStoreState"))
        set_whats_new(v["id"])
        b = wait_build()
        attach(v["id"], b["id"])
        time.sleep(3)
        submit(v["id"])

if __name__ == "__main__":
    main()
