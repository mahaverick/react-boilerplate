# Rules still on ESLint

Oxlint runs every other lint rule (`lint` block in `vite.config.ts`). These 17
rules stay on an untyped ESLint (`eslint.config.js`) until Oxlint can run them.
Move a rule when the item in its last column ships, then delete its row.

The JS plugins guide is <https://oxc.rs/docs/guide/usage/linter/js-plugins.html>.
This repo leaves `jsPlugins` out until they are stable.

| Rule                                           | Why Oxlint can't run it                                                                  | Waiting for   | Link                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------- |
| `check-file/filename-naming-convention`        | Per-glob filename rules. Oxlint's `unicorn/filename-case` takes no globs.                | JS plugins GA | [oxc#19918](https://github.com/oxc-project/oxc/issues/19918)                     |
| `check-file/folder-naming-convention`          | Per-glob folder rules. Oxlint has no folder naming rule.                                 | JS plugins GA | [oxc#19918](https://github.com/oxc-project/oxc/issues/19918)                     |
| `check-file/folder-match-with-fex`             | Maps a suffix to a folder by glob. No Oxlint equivalent.                                 | JS plugins GA | [oxc#19918](https://github.com/oxc-project/oxc/issues/19918)                     |
| `check-file/filename-blocklist`                | Per-glob filename bans with a custom message. No Oxlint equivalent.                      | JS plugins GA | [oxc#19918](https://github.com/oxc-project/oxc/issues/19918)                     |
| `jsdoc/require-jsdoc`                          | Not ported to Oxlint.                                                                    | Native port   | [oxc#1170](https://github.com/oxc-project/oxc/issues/1170)                       |
| `jsdoc/require-description`                    | Not ported to Oxlint.                                                                    | Native port   | [oxc#1170](https://github.com/oxc-project/oxc/issues/1170)                       |
| `jsdoc/check-param-names`                      | Not ported to Oxlint.                                                                    | Native port   | [oxc#1170](https://github.com/oxc-project/oxc/issues/1170)                       |
| `jsdoc/no-types`                               | Not ported to Oxlint.                                                                    | Native port   | [oxc#1170](https://github.com/oxc-project/oxc/issues/1170)                       |
| `tailwindcss/enforces-canonical-classname`     | Third-party plugin. As an alpha JS plugin it throws `ENOENT` on the CSS config.          | JS plugins GA | [oxc#19918](https://github.com/oxc-project/oxc/issues/19918)                     |
| `tailwindcss/enforces-shorthand`               | Third-party plugin, alpha JS plugins only.                                               | JS plugins GA | [oxc#19918](https://github.com/oxc-project/oxc/issues/19918)                     |
| `tailwindcss/no-contradicting-classname`       | Third-party plugin, alpha JS plugins only.                                               | JS plugins GA | [oxc#19918](https://github.com/oxc-project/oxc/issues/19918)                     |
| `tailwindcss/no-custom-classname`              | Third-party plugin, alpha JS plugins only.                                               | JS plugins GA | [oxc#19918](https://github.com/oxc-project/oxc/issues/19918)                     |
| `tailwindcss/no-unnecessary-arbitrary-value`   | Third-party plugin, alpha JS plugins only.                                               | JS plugins GA | [oxc#19918](https://github.com/oxc-project/oxc/issues/19918)                     |
| `@tanstack/router/create-route-property-order` | Third-party plugin, alpha JS plugins only.                                               | JS plugins GA | [oxc#19918](https://github.com/oxc-project/oxc/issues/19918)                     |
| `@tanstack/router/route-param-names`           | Third-party plugin, alpha JS plugins only.                                               | JS plugins GA | [oxc#19918](https://github.com/oxc-project/oxc/issues/19918)                     |
| `local/comment-style`                          | Our own rule (`scripts/comment-style.mjs`). Oxlint runs custom rules only as JS plugins. | JS plugins GA | [oxc#19918](https://github.com/oxc-project/oxc/issues/19918)                     |
| `no-restricted-syntax`                         | Oxlint has no selector-based rule. It bans test sleeps and `networkidle`.                | Native rule   | [oxc#7342](https://github.com/oxc-project/oxc/issues/7342) (closed, not planned) |

oxc#19918 is the open JS Plugins Milestone 3 issue. No issue for GA itself was
found. oxc#1170 is the open `eslint-plugin-jsdoc` port umbrella, and lists all four jsdoc rules.
