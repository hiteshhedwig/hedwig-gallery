# Hedwig's Gallery

A local photography gallery with separate design and Map pages. It discovers photographs from both source collections, reads EXIF/GPS and photoblog sidecar metadata, and prepares responsive WebP images without modifying the originals.

Default photo sources:

- `/home/hedwig/Downloads/100_FUJI_PHOTOS`
- `/home/hedwig/heetez/cool_stuff/photoblog/hedwigphoto-blog/content/about/images`

## Run

Requirements: Node.js 20+ and ImageMagick (`identify` and `convert`).

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

Open the local administration panel at [http://127.0.0.1:4173/admin.html](http://127.0.0.1:4173/admin.html). It can upload photographs, search the collection, edit titles/dates/locations/tags, select and hide many frames in one action, hide individual frames without deleting their originals, and restore hidden frames. Uploaded originals are stored in `content/uploads/` and may also be permanently deleted from Admin; external source originals can only be hidden. Admin settings are stored in `content/gallery-settings.json`.

- Xerox: `/`
- Darkroom: `/darkroom.html`
- Folio: `/folio.html`
- Ledger: `/ledger.html`
- Photo Wall: `/wall.html`
- Three Rolls: `/rolls.html`
- Time Index (homepage): `/` or `/time.html`
- Xerox archive: `/xerox.html`
- Map: `/map.html`
- Admin: `/admin.html`

The Map page uses real country boundaries on an orthographic globe. Drag or swipe to rotate it, scroll to zoom, use arrow keys when focused, or double-click to reset the view. It slowly auto-rotates when idle.

India is overridden with the official generalized external-boundary dataset published by the Survey of India (`src/india-official-outline.json`), reprojected to WGS84 and simplified for interactive rendering. The rest of the globe uses the Natural Earth-derived `world-atlas` dataset. Location dots carry photo postcards and remain attached to their geographic coordinates while the globe rotates.

The first run prepares 640, 1280, and 2200px derivatives. Later runs only process added or changed photographs and remove obsolete generated derivatives. Set `PHOTO_SOURCES` to a colon-separated list of folders to override both defaults, or use the legacy `PHOTO_SOURCE` variable for one folder.

## Controls

- Filter Home by capture year or recorded location.
- Select a frame to open the full-screen viewer.
- Use arrow keys or swipe to navigate, `F` for full screen, and `Escape` to close.
- Camera, lens, exposure, and available location data appear at the bottom of the viewer.

Generated files live in `public/photos/` and `public/gallery.json`. The source photographs remain untouched.
