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
a "you" marker sitting a little behind the live edge.

## Modes

* **Watch** – pick a station (224 across 17 countries, grouped by country, with
  favourites and search). Controls: play/pause, previous, next, jump to live,
  volume; keyboard `space` `←` `→` `L` `M` `F` `S`. The 🛡️ family filter skips
  songs FM.video marks explicit (on by default).
* **Quiz ("Blind Spot")** – ten questions built from what the station played in
  the last few hours, three lives, streak multiplier, speed bonus:
  silent video (type title or artist, hint costs 15), out-of-focus cover art
  that sharpens over ten seconds, "who's playing it" (four real stations, one
  of them played this last), higher-or-lower YouTube views, and "which did the
  station play most recently". Best score per station is kept in the browser.
* **Screensaver** – fullscreen video with a live clock, the station ident and a
  slow generative canvas in the station's own brand hue (Aurora, Signal grid or
  Orbit). Move the mouse or press a key to come back.

## How it talks to FM.video

* `https://api.fm.video/api/PlayedSongs/<stationId>/<n>` – the last *n* songs a
  station played (title, artist, YouTube id, duration, artwork, view count,
  explicit flag). CORS is open, so the browser calls it directly. Offair fetches
  40 and re-polls every 45 seconds.
* Station list (`stations.js`) – id, name, slug, country, frequency, genre,
  brand colour and logo, taken from FM.video's home page data.
* Videos play through the YouTube IFrame API. The iframe is scaled inside a
  cropping box so YouTube's title bar and controls stay out of view.

## Files

| File | What it is |
|------|------------|
| `index.html` | The three views, the player, the timeline and queue |
| `style.css` | Look and feel: Syne + Instrument Sans + JetBrains Mono, green-black studio palette |
| `app.js` | Station rail, data fetching, the ad-skipping play logic, timeline, controls |
| `quiz.js` | Question builders, round flow, fuzzy answer matching |
| `saver.js` | Screensaver: fullscreen, clock, three canvas styles |
| `stations.js` | `STATIONS` and `COUNTRIES` |

Run it by opening `index.html`, or push to GitHub Pages. Nothing is copied
from FM.video except the station list; songs are fetched live.
