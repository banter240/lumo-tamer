export default {
  branches: [
    "main",
    {
      name: "dev",
      channel: "dev",
      prerelease: "dev"
    }
  ],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      { preset: "conventionalcommits" }
    ],
    [
      "@semantic-release/release-notes-generator",
      {
        preset: "conventionalcommits",
        presetConfig: {
          types: [
            { type: "feat", section: "Features" },
            { type: "fix", section: "Bug Fixes" },
            { type: "perf", section: "Performance" },
            { type: "docs", section: "Documentation", effect: "changelog" },
            { type: "revert", effect: "hidden" },
            { type: "style", effect: "hidden" },
            { type: "chore", effect: "hidden" },
            { type: "refactor", effect: "hidden" },
            { type: "test", effect: "hidden" },
            { type: "build", effect: "hidden" },
            { type: "ci", effect: "hidden" }
          ]
        },
        writerOpts: {
          /**
           * Render each commit as header + body.
           * list() in @conventional-changelog/template already prepends "* ",
           * so we only return the inner text.
           */
          commitPartial(_context, commit) {
            let line = commit.header || "";
            if (commit.body) {
              line += `\n\n${commit.body}`;
            }
            return line;
          }
        }
      }
    ],
    [
      "@semantic-release/exec",
      { prepareCmd: "./scripts/publish.sh ${nextRelease.version}" }
    ],
    "@semantic-release/changelog",
    [
      "@semantic-release/git",
      {
        message: "chore(release): publish ${nextRelease.version}\n\n${nextRelease.notes}\n\n[skip ci]",
        assets: ["CHANGELOG.md", "package.json"]
      }
    ],
    [
      "@semantic-release/github",
      {
        successComment: false,
        failComment: false,
        failTitle: false,
        releasedLabels: false
      }
    ]
  ]
};
