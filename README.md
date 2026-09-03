# Offair

Radio stations as music-video channels, minus the ads. Built on
[FM.video](https://fm.video)'s public data.

Live: **https://lomuroundtheoutside.github.io/offair/**

## The idea

FM.video logs every song a radio station plays. Offair only ever plays those
songs, so an ad break can never reach you: when the station goes to ads, Offair
simply keeps playing from a few minutes behind (the song that just aired, from
the top) and catches up when the next song is logged. The timeline under the
video shows the last four hours as blocks (songs) and gaps (ads and talk), with
a "you" marker sitting a little behind the live edge and a count of breaks
skipped.

## Modes

The **Live** button follows the broadcast: Offair polls the log every 20 s, joins a
newly logged song at the live position, and when a song ends checks the log before
moving on. The status next to the controls is honest about the three states: `live`
(in sync), `live · station on a break` (the newest logged song has finished and the
station is in ads or talk, so it replays until something new is logged) and
`N min behind live`. Being behind during a break is the price of skipping the ads.

**Watch.** 224 stations across 17 countries, grouped by country with the
country you're in first (from FM.video's geo endpoint), favourites, and search
(`/`). A start panel suggests stations near you or your favourites. Controls:
play/pause, previous, next, jump to live, mute, volume; keyboard `space` `←`
`→` `L` `M` `F` `S` `↑` `↓` and `?` for the shortcut list. The 🛡️ family
filter skips songs FM.video marks explicit (on by default). Shows what's up
next, integrates with the OS media keys, cuts videos that run long past the
radio edit, marks videos YouTube refuses to embed, and backs off for 30 s if
YouTube fails four videos in a row instead of skipping through the whole log.

**Quiz ("Blind Spot").** Ten questions built from what the station played in
the last few hours, three lives, speed bonus, streak multiplier, hints that
cost points, a double-points final, sound effects. Nine question types: silent
video (type title or artist), out-of-focus cover art that sharpens over ten
seconds, who's playing it (four real stations), higher-or-lower YouTube views,
just played (most recent of four), odd one out (three from this station, one
from another), match the cover (four artworks), on the dial (which station is
on that frequency), and longer song. Best score per station is kept in the
browser; scores can be posted with a name to a per-station top-10 that
everyone sees (a public MQTT relay holds one retained document per player per
station), and results copy as a shareable emoji grid.

**Stream.** Makes the station look like a live stream: a LIVE badge with an uptime
clock, the station chip in its own brand colour, a lower-third for each song, a
ticker of what the station played recently and a viewer count that is entirely
made up. Three styles: Studio (badges in the corners), Broadcast (one bar along
the bottom) and Minimal. Playback is ordinary Watch mode in fullscreen, so the
fullscreen control strip works and Esc comes back. `?mode=stream` deep-links it.

**Screensaver.** Fullscreen video with a live clock and date, the station
ident, up-next, and a slow canvas animation coloured from the album art of
whatever is playing (the artwork is served with CORS, so it's sampled on a tiny
canvas). Six styles: Aurora, Vinyl (a spinning record with the cover as its
label and a tonearm), Bars, Waves, Signal grid, Orbit. Text drifts slowly to
avoid burn-in. Optionally starts by itself after 2, 5 or 10 idle minutes while
watching. Move the mouse or press a key to come back.

## How it talks to FM.video

* `https://api.fm.video/api/PlayedSongs/<stationId>/<n>` – the last *n* songs a
  station played (title, artist, YouTube id, duration, artwork, view count,
  explicit flag). CORS is open, so the browser calls it directly. Offair fetches
  40 and re-polls every 45 seconds, and again when the tab becomes visible.
* `https://api.fm.video/api/geo` – the visitor's country, used to order the
  station list.
* Station list (`stations.js`) – id, name, slug, country, frequency, genre,
  brand colour and logo, taken from FM.video's home page data.
* Videos play through the YouTube IFrame API. The iframe is scaled inside a
  cropping box so YouTube's title bar and controls stay out of view.

## Files

| File | What it is |
|------|------------|
| `index.html` | The three views, the player, the timeline and queue, help overlay |
| `style.css` | Look and feel: Syne + Instrument Sans + JetBrains Mono, green-black studio palette |
| `app.js` | Station rail, start panel, data fetching, the ad-skipping play logic, timeline, controls, media session |
| `quiz.js` | Question builders, round flow, fuzzy answer matching, scoreboard over the relay |
| `stream.js` | Stream mode: LIVE badge, uptime, viewer count, lower-third, ticker, three styles |
| `saver.js` | Screensaver: fullscreen, clock, palette from artwork, six canvas styles, idle auto-start |
| `stations.js` | `STATIONS` and `COUNTRIES` |

Run it by opening `index.html` (YouTube needs a real web origin for the video,
so use a local server, e.g. `python3 -m http.server`), or push to GitHub
Pages. Nothing is copied from FM.video except the station list; songs are
fetched live.

## Testing notes

Headless Chromium gets throttled by YouTube after a while ("This video is
unavailable", error 150, on videos that embed fine elsewhere), so verify video
playback in a real browser. Everything else (data, timeline, quiz questions,
scoreboard, screensaver canvas) can be exercised headlessly from a local
server.
