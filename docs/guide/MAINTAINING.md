# Keeping the user guide up to date

The guide is `README.md` in this folder, with its screenshots in `img/`. The web app builds both in and shows them at `/help`, so a change here reaches members with the next deploy.

## When to update it

Any change a member would notice: a new tool, a renamed button, a moved panel, a new step. The PR template asks.

## Editing the text

- Write for club members, not developers: plain UK English, short steps, one screenshot per step.
- Write it by doing the task in the app, and use the words the app uses.
- **Headings are anchors.** The app's Help and "?" links open sections by their heading (`apps/web/src/help/topics.ts`), and so do links from the forum's club guides. If you rename a heading, update `topics.ts` and say so in the PR.
- Anchors are made the way GitHub makes them (lower case, punctuation dropped, spaces to hyphens), so a link works on GitHub and in the app. Every heading needs its own.
- The contents list between `<!-- contents -->` and `<!-- /contents -->` is for readers on GitHub. `/help` draws its own from the headings.
- Only `<kbd>` is allowed as HTML. Anything else is shown as text.
- Say at the top which rctrack version the guide was written against.

`apps/web/test/help.test.tsx` checks all of this: the eight sections, the anchors, the links, and that every screenshot is used and described.

## Retaking the screenshots

`apps/web/scripts/guide-shots.mjs` takes every screenshot by doing the tasks in a running instance, at 1200 px (desktop), 1024 px (tablet) and 375 px (phone). It needs a freshly seeded instance with dev login, and it starts its own stand-in forum so that "Used at" and the lap times have something to show.

```sh
pnpm build
export DATA_DIR=/tmp/guide-data DEV_LOGIN=1 PORT=4171 BASE_URL=http://localhost:4171 \
       FORUM_URL=http://localhost:4172 SESSION_SECRET=$(openssl rand -hex 32)
rm -rf "$DATA_DIR" && mkdir -p "$DATA_DIR"
pnpm seed
(cd apps/server && node dist/main.js) &      # stop it afterwards
node apps/web/scripts/guide-shots.mjs         # all of them
node apps/web/scripts/guide-shots.mjs touch   # or one group: start, new, draw, crossover, edit, check, share, touch
```

- Screenshots are WebP, named in lower case with hyphens. Tablet ones start `tablet-` and phone ones `phone-`; the page shows phone ones narrower.
- Use the seeded example layouts and halls and the made-up people in the script. Never a real member's name or a real club's hall.
- A new step gets a new `shot(page, "name")` in the script and a `![what it shows](img/name.webp)` in the text. The alt text says what the picture shows, for members who can't see it.
- Set `PW_CHROMIUM` if Playwright's own browser isn't installed, and `FAIL_DIR` to get a picture of where a group stopped.
