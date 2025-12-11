# YouTube Playlist Downloader

A command-line tool to download YouTube Music playlists/albums as high-quality MP3s with metadata.

## Features

- ✅ Download entire YouTube Music playlists/albums
- ✅ High-quality audio (320kbps MP3)
- ✅ Automatic metadata tagging (title, artist, cover art)
- ✅ Concurrent downloads (configurable, default: 5 at a time)
- ✅ Auto-creates ZIP archives with proper names (includes artist/uploader)
- ✅ Real-time progress tracking (per-song status updates)
- ✅ Cookie support for private/unlisted/age-restricted content
- ✅ Error handling (failed songs are logged, others continue)
- ✅ No download limits (fetches entire playlists)
- ✅ Powered by yt-dlp (bypasses YouTube blocking)

## Installation

```bash
npm install
npm run build
```

## Usage

```bash
# Download a playlist
npm start -- "https://music.youtube.com/playlist?list=YOUR_PLAYLIST_ID"

# Custom output directory
npm start -- "https://music.youtube.com/playlist?list=YOUR_PLAYLIST_ID" -o ./my-music

# Download without creating ZIP
npm start -- "https://music.youtube.com/playlist?list=YOUR_PLAYLIST_ID" --no-zip

# Skip metadata tagging
npm start -- "https://music.youtube.com/playlist?list=YOUR_PLAYLIST_ID" --no-metadata

# Custom concurrency (10 songs at once)
npm start -- "https://music.youtube.com/playlist?list=YOUR_PLAYLIST_ID" -c 10
```

## Options

- `-o, --output <dir>` - Output directory (default: `./downloads`)
- `-c, --concurrency <number>` - Concurrent downloads (default: `5`)
- `--cookies <file>` - Path to cookies.txt for private/age-restricted content
- `--no-zip` - Skip ZIP creation, keep individual files
- `--no-metadata` - Skip adding ID3 tags

### Using Cookies for Private/Unlisted Playlists

If you have private, unlisted, or age-restricted content:

1. Export your YouTube cookies using a browser extension:
   - Chrome: [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
   - Firefox: [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/)
2. Save the `cookies.txt` file
3. Use the `--cookies` option:

```bash
npm start -- "YOUR_PLAYLIST_URL" --cookies "path/to/cookies.txt"
```

## Development

```bash
# Run in dev mode (with ts-node)
npm run dev -- "https://music.youtube.com/playlist?list=YOUR_PLAYLIST_ID"

# Build
npm run build

# Run compiled version
npm start -- "YOUR_PLAYLIST_URL"
```

## Architecture

```
src/
  services/
    youtube/      # Playlist fetching with ytpl
    downloader/   # Concurrent downloads with p-queue
    metadata/     # ID3 tagging with node-id3
    zipper/       # ZIP creation with archiver
  utils/          # Logger and validators
  types/          # TypeScript interfaces
  index.ts        # CLI entry point
```

## Tech Stack

- **TypeScript** - Type safety
- **ytpl** - YouTube playlist fetching
- **ytdl-core** - YouTube video downloading
- **fluent-ffmpeg** - Audio conversion
- **p-queue** - Concurrency control
- **node-id3** - Metadata tagging
- **archiver** - ZIP creation
- **commander** - CLI framework
- **ora** - Progress spinners

## Notes

- **Accurate naming**: ZIP files include both album/playlist name and artist/uploader (e.g., "Ballads — Soul Brothers.zip")
- **Real-time progress**: See individual song download/conversion status as it happens
- **yt-dlp powered**: Uses the industry-standard yt-dlp tool to bypass YouTube's anti-bot protections
- **Cookie support**: Access private, unlisted, or age-restricted content with browser cookies
- YouTube may rate-limit requests; the tool uses concurrency control to minimize this
- Failed downloads are logged but don't stop the entire process
- Cover art is automatically fetched and embedded in MP3s
- All files are sanitized for safe filesystem names

## License

ISC
