# The original site

The first version of the shop — hand-written HTML, CSS and vanilla JS, with a
`manager.html` that edited `data/products.json` by hand. It is kept because it
is the first one that worked, and because until the Vercel cutover it is still
the thing the QR code on the truck points at.

**Do not edit it and do not revive it as a route.** It is an archive. The
running shop is the Next app.

---

## Where the whole, working copy lives

Right here — except for `assets/`. The rebuild moved the images and fonts into
`public/` and left the markup behind, so **opening `legacy/index.html` today
gives you the layout with broken images and the wrong font**. The bytes are not
lost; the folder is just incomplete.

The complete, byte-for-byte original — markup *and* assets, exactly as it was
served — is tagged:

```bash
git show original-static-site --stat
```

`original-static-site` points at `d33d86c`, the last commit before the rebuild,
where `index.html`, `app.js`, `animations.js`, `style.css`, `data/` and
`assets/` all sat at the repository root and the site ran by opening it. That
tag is the copy to trust. Nothing can move it and nothing can overwrite it.

### To look at it again

```bash
git worktree add ../coffee-truck-original original-static-site
```

That checks the original out into a sibling folder, complete, without touching
this branch. Serve it with any static server (`npx serve ../coffee-truck-original`)
— not `file://`, because `app.js` fetches `data/products.json` and a browser
refuses that on a file URL.

Delete it afterwards with `git worktree remove ../coffee-truck-original`.

### Or to make *this* folder render

The eleven product photos and the two font subsets still exist under
`public/`, with identical filenames:

```bash
mkdir -p legacy/assets/fonts
cp public/products/* legacy/assets/
cp public/fonts/rubik-hebrew.woff2 public/fonts/rubik-latin.woff2 legacy/assets/fonts/
```

`legacy/assets/` is gitignored, so this reconstitutes the page locally without
committing 12 MB of images that the repository already tracks once.

---

## What the cutover does to it

Merging the rebuild into `main` takes the original site **off the air** —
GitHub Pages serves `main`, and after the merge there is no `index.html` at the
root. The files survive; the live URL does not.

So before merging, the truck's QR code has to point at the Vercel deployment
instead. That is the one thing not to get wrong, and it is written up in
[`docs/TOMORROW.md`](../docs/TOMORROW.md).
