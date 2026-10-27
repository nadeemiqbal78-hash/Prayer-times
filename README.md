# EICT prayer times for an old iPad

A free, static website for GitHub Pages. It shows today's prayer times for
Edgware Islamic Cultural Trust (EICT), counts down to the next one, plays an
azan at each of the five prayer start times, and a short chime at each
jama'ah time.

It is written in plain HTML, CSS and ES5 JavaScript so it runs on an iPad 2
(iOS 9.3.5 Safari). There is no framework and no build step.

This is an unofficial display. It copies the times from https://edgwareict.org.uk/.
It is polite to let the mosque know you are doing this.

## How it works

1. A scheduled GitHub Action runs three times a day. It reads the EICT home
   page, converts the times to 24-hour form and saves them to `times.json`.
2. The web page loads `times.json`, checks the clock every second, and plays the
   audio when a time arrives.
3. If the mosque's site is down or changes, the Action stops without touching
   `times.json`. The page keeps using the last good times and shows a red
   banner once they are more than a day old.

Times are London times. The page works out London time itself (including the
GMT/BST clock change), so it is right even if the iPad's time zone is wrong.

## 1. Get an azan audio file (you must do this)

Put your azan recording at `audio/azan.mp3`.

- Use MP3, or AAC (`.m4a`), or WAV. iOS 9 cannot play Ogg or FLAC.
- If you use `.m4a`, change `audio/azan.mp3` to your file name in `index.html`
  and in `script.js` (search for `azan.mp3`).
- Keep it under about 5 MB.
- Only use a recording you are allowed to reuse. A recording being free to
  download does not mean it is licensed for reuse. The safest options are a
  recording you or the mosque made or hold the rights to (ask EICT), or a file
  on Wikimedia Commons or the Internet Archive whose page clearly says CC0,
  public domain or a Creative Commons licence. Follow any credit
  requirement in that licence.

The short chime, `audio/chime.wav`, is already included and was generated for
this project, so there are no rights issues with it.

## 2. Put the site on GitHub Pages

1. Sign in at github.com and click **New repository**. Name it, for example,
   `eict-prayer`. Choose **Public**. Click **Create repository**.
2. Click **uploading an existing file**. Drag in everything from this folder
   **except** the `.github` folder (hidden folders often get skipped). Include
   the `audio` and `scripts` folders, and your `azan.mp3`. Click **Commit changes**.
3. Add the workflow file by hand. Click **Add file > Create new file**. In the
   name box type exactly `.github/workflows/update-times.yml` (typing the
   slashes creates the folders). Paste in the contents of the
   `update-times.yml` file from this project. Click **Commit changes**.
4. Go to **Settings > Pages**. Under **Build and deployment**, set
   **Source** to **Deploy from a branch**, branch **main**, folder **/ (root)**.
   Click **Save**.
5. Go to **Settings > Actions > General**. Under **Workflow permissions**,
   choose **Read and write permissions** and save.
6. Go to the **Actions** tab. Click **Update prayer times**, then
   **Run workflow**. Wait for a green tick.
   - A red cross means the Action could not read the mosque page. Click the run
     to see why, and send me the error text.
7. After a minute or two your site is live at
   `https://YOUR-USERNAME.github.io/eict-prayer/`.
8. The next day, check that `times.json` shows a new date and the site updated.
   Pushes made by the Action should publish automatically, but this is the one
   thing worth confirming.

You do not need to give anyone access to your GitHub account for any of this.

## 3. Set up the iPad

1. Open your site in Safari. Tap **Share > Add to Home Screen**. From now on,
   open it from that icon, which gives you a full-screen page.
2. Tap **Tap to turn sound on**. This is needed once every time the page is
   opened, because iOS blocks audio until you touch the screen.
3. **Settings > General > Auto-Lock > Never.** This is what keeps the screen on.
   The iPad 2 has no reliable software trick for this, so this setting matters.
4. Keep the iPad plugged in.
5. Turn the volume up with the side buttons. Check the side switch
   (Settings > General > Use Side Switch To) is not set to mute and is not
   muting. Press **Test azan** to check.
6. **Settings > General > Date & Time > Set Automatically** on, and keep Wi-Fi on.
7. Optional but recommended: **Settings > General > Accessibility > Guided
   Access**. Turn it on and set a passcode. Open the home-screen icon, triple-click
   the Home button, then **Start**. This stops the iPad leaving the page by accident.

## 4. Test it

- Press **Test azan** and **Test chime** at the bottom of the page.
- To test real timing, open `times.json` on GitHub (pencil icon) and change a
  prayer's `start` to about three minutes from now, in 24-hour form. Commit.
  Reload the page on the iPad, tap to turn the sound on, and wait. The next run
  of the Action will put the real times back. You can also run it by hand.
- Testing the clock change: the logic was checked against 29 March and 25
  October 2026 (the 2026 clock changes), and the alert logic against GMT and BST.

## 5. Limits you should know about

- **The alert only works while the page is open and the screen is awake.** iOS 9
  has no background audio for web pages, no notifications, and no service
  workers. If the iPad sleeps, restarts, or Safari closes the page, there will
  be no azan until you reopen it and tap the sound button.
- Scheduled GitHub jobs can start a few minutes late. That is fine for
  `times.json`, which only needs refreshing once a day.
- GitHub can pause scheduled workflows in a repository with no activity for 60
  days. The daily commits normally prevent that. If the red banner appears,
  open the **Actions** tab, re-enable the workflow if asked, and run it.
- The first number on the mosque's page for each prayer is treated as the adhan
  time and the second as the jama'ah time. Check this against the website.
- If EICT redesigns its site, the scraper may stop working. It refuses to save
  anything that looks wrong (missing prayers, times out of order) and GitHub
  will email you that the run failed.
- I could not test on a real iPad 2. Check it for a day before relying on it.
