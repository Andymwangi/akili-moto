#!/usr/bin/env python3
"""Turn the reviewed shortlist into final word files.

Usage:
  python3 finalize_answers.py --dir out

Reads (in --dir):
  answers-shortlist.csv     reviewer sets column `keep` to y for approved answers
  dictionary-candidates.txt permissive guess dictionary
  dictionary-remove.txt     optional, one word per line the reviewer wants removed (junk, offensive)
  blocklist.txt             optional, one word per line, never allowed as answers or guesses

Writes:
  answers.txt, dictionary.txt

Checks: lowercase a-z, exactly 5 letters, no duplicates, every answer is in the dictionary,
nothing blocked, and warns if fewer than 365 answers are approved.
"""
import argparse, csv, os, re, sys

FIVE = re.compile(r"^[a-z]{5}$")

def read_words(path):
    if not os.path.exists(path):
        return set()
    out = set()
    for line in open(path, encoding="utf-8"):
        w = line.split("#")[0].strip().lower()
        if w:
            out.add(w)
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="out")
    a = ap.parse_args()
    d = a.dir
    dictionary = read_words(os.path.join(d, "dictionary-candidates.txt"))
    remove = read_words(os.path.join(d, "dictionary-remove.txt"))
    block = read_words(os.path.join(d, "blocklist.txt"))
    answers = set()
    with open(os.path.join(d, "answers-shortlist.csv"), encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            if r.get("keep", "").strip().lower() in ("y", "yes"):
                answers.add(r["word"].strip().lower())
    errors = []
    for w in sorted(answers | dictionary):
        if not FIVE.match(w):
            errors.append(f"invalid shape: {w!r}")
    if errors:
        print("\n".join(errors)); sys.exit(1)
    dictionary = (dictionary | answers) - remove - block
    clash = answers & (remove | block)
    if clash:
        print("These approved answers are also removed or blocked, fix the files:", sorted(clash)); sys.exit(1)
    missing = answers - dictionary
    assert not missing
    with open(os.path.join(d, "answers.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(sorted(answers)) + "\n")
    with open(os.path.join(d, "dictionary.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(sorted(dictionary)) + "\n")
    print(f"answers: {len(answers)}  dictionary: {len(dictionary)}  removed: {len(remove)}  blocked: {len(block)}")
    if len(answers) < 365:
        print(f"WARNING: only {len(answers)} approved answers, need at least 365 for a year of play.")

if __name__ == "__main__":
    main()
