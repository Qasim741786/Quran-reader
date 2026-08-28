# Nur

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

## Publish to the Apple App Store

This project now includes a Capacitor iOS wrapper. The Quran, translation, tafsir, IndoPak font, icons, and reader code are copied into the native app at build time, so reading works without a network connection from the first launch of the installed iOS app.

### One-time setup

1. Install the full [Xcode](https://apps.apple.com/app/xcode/id497799835) app from the Mac App Store and open it once to accept its licence.
2. Join the [Apple Developer Program](https://developer.apple.com/programs/enroll/) before uploading a public App Store build.
3. From this folder, run:

   ```bash
   npm install
   npm run ios:open
   ```

   This refreshes `ios/App/App/public` from the local reader files and opens the Xcode workspace.

### In Xcode

1. Select the **App** target, then **Signing & Capabilities**.
2. Choose your Apple Developer **Team** and keep (or change) the unique bundle identifier `com.qasimwaheed.quranreader`.
3. Set the version and build number under **General**.
4. Choose an iPhone simulator or connected iPhone and press Run to test. Turn on Airplane Mode: the reader, all 114 surahs, translation, tafsir, tajweed text, and font should still work.
5. Select **Product → Archive**, then **Distribute App → App Store Connect → Upload**.

### App Store Connect

Create the app record in [App Store Connect](https://appstoreconnect.apple.com/), attach the uploaded build, add a 1024×1024 icon, iPhone screenshots, description, support URL, privacy details, and submit it to TestFlight before App Review.

Before a public release, confirm you have redistribution permission for every recitation, tafsir, and translation included in the app. Audio currently streams when it has not been cached; it is not part of the 32 MB offline reader bundle.

## Optional custom domain

In Cloudflare Pages, open your project and go to **Custom domains** → **Set up a domain**. A `pages.dev` address is enough to install the app, so you can add this later if you wish.
