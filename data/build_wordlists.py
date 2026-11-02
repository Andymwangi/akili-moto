#!/usr/bin/env python3
"""Build candidate Swahili 5-letter word lists from open sources.

Inputs (downloaded by fetch step, see docs/WORDLISTS.md):
  raw/sw_asp.txt      African Storybook Project frequency list (count<TAB>word)
  raw/sw_TZ.dic/.aff  Swahili Hunspell dictionary (LGPL)
  raw/cv/*.txt        Common Voice Swahili sentence files

Outputs (written to out/):
  dictionary-candidates.txt   permissive list of valid guesses (one word per line)
  answers-shortlist.csv       ranked candidates for HUMAN review (column `keep` is for the reviewer)
  build-stats.txt             counts and thresholds used

No word is invented. Every word comes from at least one source file.
Words are lowercase a-z only, exactly 5 letters (decision D5). Words containing
apostrophes (for example ng') are excluded and counted, not rewritten.
"""
import csv, collections, glob, os, re, sys

BASE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(BASE, "raw")
OUT = os.path.join(BASE, "out")
os.makedirs(OUT, exist_ok=True)

FIVE = re.compile(r"^[a-z]{5}$")
TOKEN = re.compile(r"[A-Za-z']+")

# Dialect sentence files are excluded from frequency counts (non-standard spellings).
DIALECT = {"sw-baratz.txt", "sw-kibajuni.txt", "sw-kimakunduchi.txt", "sw-kimvita.txt",
           "sw-kipemba.txt", "sw-kitumbatu.txt", "sw-kiunguja.txt"}

# --- thresholds (tunable) ---
MIN_CV_FREQ_DICT = 2        # a corpus-only word needs this many corpus hits to enter the dictionary
MIN_ANSWER_SCORE = 3        # combined corpus score needed to be an answer candidate
MAX_CAP_RATIO = 0.25        # above this share of mid-sentence capitalization, treat as likely proper noun

stats = collections.OrderedDict()

# ---------- ASP ----------
asp = {}
with open(os.path.join(RAW, "sw_asp.txt"), encoding="utf-8") as f:
    for line in f:
        parts = line.rstrip("\n").split("\t")
        if len(parts) == 2 and parts[0].isdigit():
            w = parts[1].lower()
            asp[w] = asp.get(w, 0) + int(parts[0])
asp5 = {w: c for w, c in asp.items() if FIVE.match(w)}
stats["asp_total_words"] = len(asp)
stats["asp_5letter"] = len(asp5)

# ---------- Hunspell ----------
hun_lower, hun_cap, hun_flags = set(), set(), {}
with open(os.path.join(RAW, "sw_TZ.dic"), encoding="latin-1") as f:
    next(f)  # count line
    for line in f:
        line = line.rstrip("\n")
        w, _, flags = line.partition("/")
        if not w:
            continue
        if w[0].isupper():
            hun_cap.add(w.lower())
        else:
            hun_lower.add(w)
            if flags:
                hun_flags[w] = flags
# prefix expansion for flag A (from sw_TZ.aff: wali, ali, tuli, zili)
PREFIXES_A = ["wali", "ali", "tuli", "zili"]
hun_expanded = set()
for stem, flags in hun_flags.items():
    if "A" in flags:
        for p in PREFIXES_A:
            hun_expanded.add(p + stem)
hun5 = {w for w in hun_lower if FIVE.match(w)}
hun5_exp = {w for w in hun_expanded if FIVE.match(w)}
hun5_cap_only = {w for w in hun_cap if FIVE.match(w)} - hun_lower
stats["hunspell_entries"] = len(hun_lower) + len(hun_cap)
stats["hunspell_lowercase_5letter"] = len(hun5)
stats["hunspell_prefix_expanded_5letter"] = len(hun5_exp)
stats["hunspell_capitalized_only_5letter"] = len(hun5_cap_only)

# ---------- Common Voice sentences ----------
cv_files = [p for p in sorted(glob.glob(os.path.join(RAW, "cv", "*.txt"))) if os.path.basename(p) not in DIALECT]
cv_total = collections.Counter()
cv_cap_mid = collections.Counter()   # capitalized and not the first token of the sentence
cv_mid_total = collections.Counter()  # not first token of sentence (any case)
apos_5 = collections.Counter()
tokens_seen = 0
for p in cv_files:
    with open(p, encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.replace("\u2019", "'").replace("\u2018", "'").replace("\u02bc", "'")
            toks = TOKEN.findall(line)
            for i, t in enumerate(toks):
                tokens_seen += 1
                tl = t.lower().strip("'")
                if "'" in tl:
                    if len(tl.replace("'", "")) == 5:
                        apos_5[tl] += 1
                    continue
                if not FIVE.match(tl):
                    continue
                cv_total[tl] += 1
                if i > 0:
                    cv_mid_total[tl] += 1
                    if t[0].isupper():
                        cv_cap_mid[tl] += 1
stats["cv_files_used"] = len(cv_files)
stats["cv_tokens"] = tokens_seen
stats["cv_distinct_5letter"] = len(cv_total)
stats["apostrophe_words_excluded_5_after_stripping"] = len(apos_5)

def cap_ratio(w):
    m = cv_mid_total.get(w, 0)
    return (cv_cap_mid.get(w, 0) / m) if m else 0.0

# ---------- Dictionary (permissive) ----------
dictionary = set()
reasons = collections.defaultdict(set)
def add(w, why):
    dictionary.add(w); reasons[w].add(why)
for w in hun5: add(w, "hunspell")
for w in hun5_exp: add(w, "hunspell_prefix")
for w in asp5: add(w, "asp")
for w, c in cv_total.items():
    if c >= MIN_CV_FREQ_DICT and cap_ratio(w) <= 0.6:
        add(w, "corpus")
# capitalized-only hunspell entries are mostly names; accept only if seen lowercase in the corpus often
for w in hun5_cap_only:
    if cv_total.get(w, 0) >= 3 and cap_ratio(w) <= MAX_CAP_RATIO:
        add(w, "hunspell_cap_but_common")
stats["dictionary_candidates"] = len(dictionary)

# ---------- Answer shortlist ----------
rows = []
for w in sorted(dictionary):
    cvf = cv_total.get(w, 0)
    af = asp5.get(w, 0)
    in_hun = w in hun5
    score = cvf + 2 * af     # simple blend, ASP is smaller so weight it up
    cr = cap_ratio(w)
    if score < MIN_ANSWER_SCORE:
        continue
    if cr > MAX_CAP_RATIO:
        continue
    if not (in_hun or af > 0):
        continue             # must be backed by a dictionary or the storybook corpus, not corpus noise alone
    rows.append({"word": w, "score": score, "common_voice_freq": cvf, "asp_freq": af,
                 "in_hunspell": "yes" if in_hun else "no",
                 "cap_ratio": round(cr, 2),
                 "sources": "+".join(sorted(reasons[w])),
                 "keep": "", "notes": ""})
rows.sort(key=lambda r: (-r["score"], r["word"]))
for i, r in enumerate(rows, 1):
    r["rank"] = i
stats["answer_candidates_for_review"] = len(rows)

# ---------- write ----------
with open(os.path.join(OUT, "dictionary-candidates.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(sorted(dictionary)) + "\n")
cols = ["rank", "word", "score", "common_voice_freq", "asp_freq", "in_hunspell", "cap_ratio", "sources", "keep", "notes"]
with open(os.path.join(OUT, "answers-shortlist.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)
with open(os.path.join(OUT, "build-stats.txt"), "w", encoding="utf-8") as f:
    for k, v in stats.items():
        f.write(f"{k}: {v}\n")
    f.write(f"thresholds: MIN_CV_FREQ_DICT={MIN_CV_FREQ_DICT} MIN_ANSWER_SCORE={MIN_ANSWER_SCORE} MAX_CAP_RATIO={MAX_CAP_RATIO}\n")
for k, v in stats.items():
    print(f"{k}: {v}")
