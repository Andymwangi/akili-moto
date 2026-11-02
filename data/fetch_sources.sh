#!/usr/bin/env bash
# Download the open source files used by build_wordlists.py into ./raw
set -euo pipefail
mkdir -p raw/cv
curl -fsS -o raw/sw_asp.txt https://raw.githubusercontent.com/dohliam/more-stoplists/master/sw/sw_frequency_list.txt
for f in sw_TZ.dic sw_TZ.aff README_sw_TZ.txt; do
  curl -fsS -o "raw/$f" "https://raw.githubusercontent.com/LibreOffice/dictionaries/master/sw_TZ/$f"
done
for f in batch-1-16-02-2023-badili-livestock-diseases-set.txt batch-1-19-11-2021-contributors-set.txt \
         batch-2-07-02-2022.txt batch-2-10-03-2023-agriculture-set.txt batch-2-11-07-2022-contributors-set.txt \
         batch-3-17-08-2022-contributors-set.txt batch-4-08-02-2023-contributors-set.txt \
         sentence-collector.txt wiki.sw.txt; do
  curl -fsS -o "raw/cv/$f" "https://raw.githubusercontent.com/common-voice/common-voice/main/server/data/sw/$f"
done
echo "done"
