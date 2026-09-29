# ARD conformance tester, vendored

From `ards-project/ard-spec` at commit `b76f235a8f461876ad4f1e77abd0eb0eb302b48d` (2026-09-12), spec v0.91.
Licensed Apache-2.0: see `LICENSE`, copied from the same commit.

Three files are copied unchanged, at the paths they have in that repo. The tester reads its schema from
`../../spec/schemas/` relative to `bin/`, so the layout is kept. Do not edit these files: to update, copy a newer
commit's files and change the commit and the hashes below. `tests/ard-trust.test.mjs` checks the hashes.

sha256 dfe0e2a538e0e9004d43d1f57598177793109f5662706ccd1b1cb93c7fa34ce5 LICENSE
sha256 ac2f3cae1c4ac75261fe45786a117aaad275322c92b74110529ad03a794275b4 conformance/bin/conformance-test
sha256 011b86d55fd5d2883dffae3f0577d26f5efb56ca866eb079edbc78a628f95499 spec/schemas/ard-entry.schema.json

Run: `python3 scripts/vendor/ard-conformance/conformance/bin/conformance-test manifest .well-known/ard.json`
