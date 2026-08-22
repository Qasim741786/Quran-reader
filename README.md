# Quran Reader

An installable, offline-first Quran reader with IndoPak text, embedded waqf/wasl markings, English translation, and a bundled Quran dataset.

## Deploy to Cloudflare Pages

### 1. Put this folder on GitHub

1. Create a new, empty GitHub repository (for example `quran-reader`).
2. In Terminal, from this project folder, run:

   ```bash
   git add .
   git commit -m "Create offline Quran reader"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/quran-reader.git
   git push -u origin main
   ```

### 2. Create the Cloudflare Pages site

1. Sign in to [Cloudflare](https://dash.cloudflare.com/), then select **Workers & Pages**.
2. Choose **Create application** → **Pages** → **Connect to Git**.
3. Authorize GitHub and select the `quran-reader` repository.
4. Use these settings:

   - Framework preset: **None**
   - Build command: `exit 0`
   - Build output directory: `.`

5. Select **Save and Deploy**.

Cloudflare will provide a secure address like `https://quran-reader.pages.dev`. Future pushes to `main` deploy automatically.

## Install on iPhone

1. Open the `https://…pages.dev` address in **Safari** on your iPhone.
2. Tap **Share**.
3. Select **Add to Home Screen**, then tap **Add**.
4. Open the new Quran icon from your Home Screen. Once opened, the reader’s Quran data and font are cached for offline use.

## Optional custom domain

In Cloudflare Pages, open your project and go to **Custom domains** → **Set up a domain**. A `pages.dev` address is enough to install the app, so you can add this later if you wish.
