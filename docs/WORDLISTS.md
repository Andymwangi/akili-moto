# Word-list readiness

The owner-supplied source files and their provenance are documented in [`data/WORDLISTS.md`](../data/WORDLISTS.md). They are machine-generated candidates, not approved game content. On 2026-11-02, the shortlist had 1,006 entries and zero `keep` approvals. The dictionary had 5,442 candidates, and `blocklist.txt` contained no entries beyond comments.

No source word was chosen as a daily answer or shipped as an allowed guess. Fluent review is still required for commonness, grammar, names, offensive language, dialect and licensing. Until that review is complete, local game data comes only from `test/fixtures/answers.txt` and `test/fixtures/dictionary.txt`; those words are intentionally fake.

## Owner review needed

- Approve at least 365 answers in `data/answers-shortlist.csv` by setting `keep` to `y`.
- Review the candidate dictionary, add junk to `data/dictionary-remove.txt`, and add offensive or otherwise excluded words to `data/blocklist.txt`.
- Verify the source and licence details in `data/WORDLISTS.md` before any public release.
- Run `python data/finalize_answers.py --dir data` only after review. The final `answers.txt` and `dictionary.txt` are not present yet.

The application is not ready for public gameplay until those files are finalized and loaded into the intended D1 environment.
