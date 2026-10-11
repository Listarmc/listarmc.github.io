# Listar MC website

Source for **[listar-mc.net](https://listar-mc.net)**, served by GitHub Pages straight from `main`.
Plain static HTML/CSS/JS: there is no build step.

![](https://i.imgur.com/0liBLWU.png)

## Layout

```
index.html                 Home page: hero, pack catalogue, support/FAQ, footer
Packs/<Pack-Name>.html     One page per pack (URL is public; do not rename)
Privacy Policy.html        Privacy policy
admin.html                 Admin panel: edit packs and publish to GitHub (see below)

assets/
  css/
    site.css               Global theme for all public pages (variables, header, footer, grid…)
    home.css               index.html only
    pack.css               Pack pages: layout, gallery, download buttons, lightbox
    pack-support.css       Pack pages: ad-blocker notice + "support" reminder
    privacy.css            Privacy Policy only
    admin.css              admin.html only
  js/
    home.js                index.html: search, filters, sort, pagination, featured carousel
    pack.js                Pack pages: mobile menu, ad-blocker notice, reminder, lightbox
    privacy.js             Privacy Policy only
    admin.js               admin.html only

thumbnails/                Pack card thumbnails used by index.html
Packs/*.png                CurseForge / Modrinth button icons for pack pages
logo.gif, fav.gif,         Site images (kept at the root so existing URLs keep working)
coffe.png, PMC.webp,
5446991.jpg                Page background (referenced from site.css and admin.css)

CNAME, ads.txt, sitemap.xml,          Hosting / AdSense / SEO files — must stay at the root
.github/workflows/static.yml          GitHub Pages deploy
8b23bf5478fb45518bc1c2142b2c9b31.txt, Site-verification files — must stay at the root
BqdaFrjg9.js
```

## Stylesheet order matters

Each page loads, in this order: `site.css` → (page CSS) → Font Awesome → page-specific CSS.
`home.css`, `pack-support.css` and `privacy.css` are linked **after** Font Awesome on purpose:
some of their rules (for example `.support-icon`) override `.fa` at equal specificity.

## Deploying

`.github/workflows/static.yml` deploys the whole repo to GitHub Pages on every push to `main`.
In the repo's **Settings → Pages**, *Source* must be **GitHub Actions**.

## Admin panel (`admin.html`)

Open `https://listar-mc.net/admin.html` (or the file locally) and paste a GitHub token.

Token: GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token
- Repository access: only `Listarmc/listarmc.github.io`
- Permissions: **Contents: Read and write** (required), **Actions: Read and write** (optional: deploy
  status and the Redeploy button)

The token stays in your browser (this tab, or this device if you tick *Remember*) and is only
sent to `api.github.com`. Anyone can open admin.html, but it does nothing without a token.

What it does:
- Lists every pack (home page cards + `Packs/*.html`) and flags cards without a page and vice versa.
- **Home page card** tab: title, description, thumbnail, date, ribbon, versions, theme, scale,
  downloads, tags. New versions/themes are added to the home page filter dropdowns automatically.
- **Pack page** tab: title, Google description, heading, cover, badges, preview thumbnails,
  lightbox screenshots, features, description, highlights, download links, compatibility.
- **Page HTML** tab: edit the raw page for anything the form doesn't cover.
- **New pack**: copies the layout of an existing page, adds a card at the top of the home page and
  a sitemap entry. **Delete pack** removes all three.
- Image **Upload** buttons put files in `thumbnails/`.
- **Publish** sends everything as one commit (refuses if the same files changed on GitHub since you
  loaded them), then shows the deploy progress.

## Adding a pack by hand

1. Copy a page in `Packs/` that links `../assets/js/pack.js`, and change its content.
2. Add a `.pack-card` for it at the top of `#packs-container` in `index.html`.
3. Add the URL to `sitemap.xml`.
