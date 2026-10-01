# Kagaz → App — 2-minute stage script

**Kagaz** means paper. The pitch: *the paper sketch is the spec. Claude Code builds it while you watch.*

## Before you go on (T-15 min)

- [ ] Laptop on power, Do Not Disturb on, notifications off, screen mirroring tested.
- [ ] `cd kagaz-app && npm run dev`. Open **http://localhost:3000** in Chrome, full screen
      (`⌃⌘F` on Mac / `F11`), zoom 100%.
- [ ] Do one **real** warm-up build with a sample (checks that you're logged in and have usage left),
      then press **Reset**. It also leaves one app in the **Gallery** as a fallback.
- [ ] Phone: press **Phone → Enable phone upload**, scan the QR code, send one test photo, then Reset.
      Venue Wi-Fi often blocks phone-to-laptop traffic. If it does, turn on your phone's hotspot and
      put the laptop on it.
- [ ] On the table: white A4 paper and a **thick black marker** (pencil is too faint for the camera).
- [ ] Optional: tape a sample sketch under the table in case the judge freezes.

## The script

| Time | On stage | What you say |
|---|---|---|
| 0:00 | Stage screen showing "Waiting for a sketch…" | "Every app starts as a sketch on paper, on *kagaz*. What if the sketch *was* the app?" |
| 0:10 | Hand the judge the marker and paper | "Draw me any app: a todo list, a menu, a calculator, anything. Boxes, buttons, a few words. Thirty seconds." |
| 0:15 | Judge draws. Point at the screen | "Left: the photo and Claude Code's live activity. Right: a real React app running on this laptop. Claude only gets file read and write tools, locked to one folder: no terminal, no internet." |
| 0:45 | Snap the sketch with the phone page (or drop the photo onto the screen) | "Snap. The timer starts now." |
| 0:50 | Feed shows **Reading sketch…** | "It's looking at the drawing first: layout, labels, the little arrows and notes." |
| 1:00 | **Creating App.tsx…** with the line count climbing; the preview appears | "That's the first draft, hot-reloading in. Now it's wiring up the real logic." |
| 1:30 | **App ready** and the timer stops ("Kagaz se App: 52s") | "Fifty-two seconds from paper to app." Click around: add an item, tick a box, add to cart. "Real state, real buttons." |
| 1:40 | Ask the judge for a change, type it in the tweak box | "Judge, what should it do differently?" Type it, e.g. *make it dark mode*. "Same session, so Claude remembers what it built." |
| 1:55 | Tweak lands live | "Kagaz se App. Thank you!" |

## If something goes wrong

| Problem | Do this |
|---|---|
| Camera / phone upload fails | Click a **Try a sample** button (Todo · Chai menu · Calculator), or drag a photo from AirDrop/Downloads onto the screen. |
| Phone can't open the QR link | Same Wi-Fi? Venue Wi-Fi often isolates devices: use your hotspot. On macOS, allow incoming connections for `node` if the firewall asks. |
| Claude is slow or stuck | Keep talking ("it's reading the handwriting"). After ~90s, press **Stop**, open **Gallery**, and **Restore** the warm-up build. |
| Preview is blank or shows a red error | Press the preview's **reload** button. If it stays broken, type a tweak: *fix the error so the app renders*. |
| Error "not logged in" or usage limit | Open the **Gallery** and restore a build. Afterwards, run `claude` in a terminal and `/login`. |
| Everything is on fire | `npm run dev:mock` plays a fake Claude run: no network, no usage. Say so honestly. |

## Good sketches for the judge (if they ask)

- "A to-do list with checkboxes and a delete button"
- "A chai stall menu with prices and an order total"
- "A calculator with a history of results"
- "A habit tracker with streaks", "a split-the-bill calculator", "a cricket scoreboard"
