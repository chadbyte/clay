# Contributing to Clay Studio

Bug reports, feature suggestions, and pull requests for bug fixes and performance improvements are welcome.

## Contribution scope

External code contributions are limited to bug fixes and performance improvements. New features, intentional changes to product behavior, and major structural changes are designed and implemented by the maintainer. You can propose and discuss those changes in [GitHub Issues](https://github.com/chadbyte/clay/issues), but please do not submit implementations for them. Discussion of a proposal does not open it to external implementation.

A bug fix restores intended behavior; it should explain the defect and the expected result. A performance improvement should preserve intended behavior and provide evidence of the improvement. If either requires a major structural change, open an issue to share your findings; the maintainer will handle the implementation. If you are unsure whether a change fits, ask in an issue before starting work.

## Bug reports and suggestions

For a bug report, include your Clay Studio version, operating system, coding-agent runtime where relevant, steps to reproduce, and expected and actual behavior. Remove credentials and private conversation or project data from logs and examples.

Feature suggestions and documentation error reports are also welcome in issues. Explain the problem you want to solve and the outcome you need.

## Bug-fix and performance pull requests

Keep each PR focused on one problem and link the relevant issue, if one exists. Include:

- A description of the problem and why the change addresses it.
- Reproduction steps for bugs, or before-and-after measurements for performance improvements, including the environment and workload used.
- Relevant regression tests and the validation you ran.
- Any compatibility considerations or limits of your verification.

Follow the conventions in the surrounding code. Avoid bundling unrelated cleanup, dependency upgrades, new features, or major refactors into a fix. Update affected public documentation when needed.

The maintainer makes the final decisions on scope, design, and merging. Submitting a PR does not guarantee acceptance.

## License

By submitting a PR, you license your original changes under [AGPL-3.0-only](LICENSE) and confirm that you have the right to do so. Contributors retain their copyright. There is no CLA or DCO requirement.

If you include third-party material, identify its source and license and preserve required notices. Existing MIT-covered portions and third-party material retain their applicable licenses and notices; see the [licensing scope notice](LICENSES/README.md). This contribution policy does not restrict rights granted by those licenses.
