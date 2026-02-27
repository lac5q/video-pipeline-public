# Music Library -- Available Tracks for TurnedYellow Videos

**Purpose:** Reference for all music tracks used or available for video builds, with licensing and copyright information.

---

## Music Storage

Music files are stored at `/tmp/brand-music/` on the local machine.

**WARNING:** The `/tmp/` directory may be cleared on reboot. If files are missing, re-download with yt-dlp:

```bash
mkdir -p /tmp/brand-music
cd /tmp/brand-music
yt-dlp -x --audio-format mp3 "YOUTUBE_URL" -o "Artist - Title.%(ext)s"
```

---

## Available Tracks

### Pop / Chill

| Track | Artist | Genre | BPM | Mood | License |
|-------|--------|-------|-----|------|---------|
| Dance With Me | Ehrling | Pop | ~110 | Upbeat, fun | Free with credit |
| Champagne Ocean | Ehrling | Pop | ~105 | Happy, celebratory | Free with credit |
| California | LiQWYD | Pop/Chill | ~100 | Sunny, relaxed | Free with credit |
| Hawaii | LiQWYD | Pop/Chill | ~95 | Tropical, warm | Free with credit |

### EDM / NCS (NoCopyrightSounds)

| Track | Artist | Genre | BPM | Mood | License |
|-------|--------|-------|-----|------|---------|
| Candyland | Tobu | EDM | ~128 | Energetic, happy | NCS -- free with credit |
| Sky High | Elektronomia | EDM | ~128 | Uplifting, triumphant | NCS -- free with credit |

---

## Licensing Rules

### NCS (NoCopyrightSounds) Tracks
- **Free for non-profit AND commercial use** on YouTube, TikTok, Instagram, X
- **MUST credit** the artist in the video description
- Credit format for YouTube:
  ```
  Music: Artist - Track Name [NCS Release]
  Free Download/Stream: https://ncs.io/trackname
  ```

### "FREE" YouTube Beats
- Usually free for **NON-PROFIT use only**
- Must credit the producer
- Need a separate license for commercial use
- Check individual track licensing before using

### Real Songs (2Pac, Drake, etc.)
- **COPYRIGHTED** -- will trigger Content ID claims on YouTube
- Automatic claims = revenue goes to copyright holder
- May get the video muted or blocked in some regions
- **Do NOT use** for YouTube or any platform where monetization matters

### Platform-Specific Strategy
| Platform | Best Approach |
|----------|---------------|
| YouTube Shorts | Free NCS beat with credit in description |
| TikTok | Add platform music in-app (using TikTok's licensed library) |
| Instagram Reels | Add platform music in-app (using IG's licensed library) |
| X (Twitter) | Free NCS beat with credit |

---

## Recommended Tracks by Video Type

### UGC (Reaction Videos)
- **Tobu - Candyland**: Energetic enough to complement reactions, not too overwhelming
- **Ehrling - Dance With Me**: Fun vibe that matches gift-opening energy

### Standard Product Showcases
- **LiQWYD - California**: Relaxed, lets the products speak for themselves
- **Elektronomia - Sky High**: Uplifting, good for aspirational product display

### Holiday / Gift-Themed
- **LiQWYD - Hawaii**: Warm, feel-good vibe for gift-giving content
- **Ehrling - Champagne Ocean**: Celebratory mood

---

## Audio Mixing Settings

When using music with reaction videos (UGC variant):

| Setting | Value | Notes |
|---------|-------|-------|
| Music volume during reaction | 25% (0.25) | Ducked so reaction audio is clear |
| Music volume elsewhere | 100% (1.0) | Full volume before/after reaction |
| Music fade in | 0.5s | Gentle start |
| Music fade out | 1.5s from end | Smooth ending |
| Audio codec | AAC | Standard for social media |
| Audio bitrate | 192kbps | Good quality without huge file size |

### Quick Music Swap
To change music without rebuilding the entire video, use `swap-music.sh`:
```bash
# From the workspace that has the video
swap-music.sh --input video.mp4 --music /tmp/brand-music/new-track.mp3 --output video-new-music.mp4
```
This takes ~2 seconds vs ~3 minutes for a full rebuild.
