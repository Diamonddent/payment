import json, re, collections

P = r"C:\Users\naiem\Downloads\payment-main\_records_dump.json"
with open(P, encoding="utf-8") as f:
    payload = json.load(f)
data = payload["data"]

print("TOTAL RECORDS:", len(data))
print("KEYS:", list(data[0].keys()))

reqs = [r.get("Request Number") for r in data]
nums = sorted(int(re.sub(r"\D", "", x)) for x in reqs if x and re.sub(r"\D", "", x))
print("FIRST:", reqs[0], " LAST:", reqs[-1], " MIN:", nums[0], " MAX:", nums[-1])
s = set(nums)
missing = [n for n in range(nums[0], nums[-1] + 1) if n not in s]
print("MISSING IN RANGE:", len(missing), missing[:40])
print("HIGHEST 8 REQS:", reqs[-8:])

seen = collections.Counter(reqs)
dups = {k: v for k, v in seen.items() if v > 1}
print("DUPLICATE REQ NUMS:", len(dups), list(dups.items())[:10])

print("\nPayment Terms:", collections.Counter(repr(r.get("Payment Terms")) for r in data).most_common())
print("Currency:", collections.Counter(repr(r.get("Currency")) for r in data).most_common())
print("Amount types:", collections.Counter(type(r.get("Total Amount")).__name__ for r in data))

nan_rows = [r for r in data if r.get("Total Amount") not in (None, "") and
            not re.fullmatch(r"-?\d+(\.\d+)?", str(r["Total Amount"]).strip())]
print("\nROWS WHERE Number(amount) => NaN:", len(nan_rows))
for r in nan_rows[:15]:
    print("   ", r.get("Request Number"), repr(r.get("Total Amount")))

def shape(v):
    v = str(v or "")
    if re.fullmatch(r"\d{2}/\d{2}/\d{4}", v): return "slash DD/MM or MM/DD"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v): return "iso YYYY-MM-DD"
    if re.fullmatch(r"\d{2}/\d{2}/\d{2,4}", v): return "short slash"
    return "OTHER:" + v

print("\nDate shapes:", collections.Counter(shape(r.get("Date")) for r in data).most_common(8))
print("SubmittedAt shapes:", collections.Counter(shape(r.get("Submitted At")) for r in data).most_common(8))

ddmm = mmdd = 0; samples = []
for r in data:
    d, sb = str(r.get("Date") or ""), str(r.get("Submitted At") or "")
    if re.fullmatch(r"\d{2}/\d{2}/\d{4}", d) and re.fullmatch(r"\d{2}/\d{2}/\d{4}", sb) and d != sb:
        dp, sp = d.split("/"), sb.split("/")
        if dp[0] == sp[1] and dp[1] == sp[0]:
            if int(dp[0]) > 12: ddmm += 1
            else: mmdd += 1
            if len(samples) < 10: samples.append((r.get("Request Number"), d, sb))
print(f"\nDate vs SubmittedAt swapped: Date=DD/MM evidence={ddmm}, Date=MM/DD evidence={mmdd}")
for x in samples: print("   ", x)

print("\nEMPTY FIELDS:")
for k in data[0].keys():
    n = sum(1 for r in data if not str(r.get(k) if r.get(k) is not None else "").strip())
    print(f"   {k:20s} empty {n}/{len(data)}")

print("\nSAMPLE newest 3:")
for r in data[-3:]:
    print("   ", json.dumps(r, ensure_ascii=False)[:400])
