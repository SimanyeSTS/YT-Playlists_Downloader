import { execSync } from 'child_process';
import { extractPlaylistId, isValidYouTubeUrl } from '../../utils/validator.js';
import type { Playlist, Song } from '../../types/index.js';

/**
 * Validates URL and extracts playlist ID
 */
export async function validateAndExtractId(url: string): Promise<string> {
  if (!isValidYouTubeUrl(url)) {
    throw new Error(`Invalid YouTube URL: ${url}`);
  }

  const playlistId = extractPlaylistId(url);
  if (!playlistId) {
    throw new Error(`Could not extract playlist ID from URL: ${url}`);
  }

  return playlistId;
}

/**
 * Fetches playlist metadata using yt-dlp
 */
export async function fetchPlaylistMetadata(playlistId: string, cookiesFile?: string): Promise<Playlist> {
  try {
    const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
    const cookiesArg = cookiesFile ? `--cookies "${cookiesFile}"` : '';
    
    let data: any;
    let playlistTitle = 'Unknown Playlist';
    let uploader: string | undefined;
    
    // Try -J first for complete metadata
    try {
      const command = `py -m yt_dlp -J ${cookiesArg} --no-warnings "${playlistUrl}"`;
      const jsonText = execSync(command, {
        encoding: 'utf-8',
        maxBuffer: 200 * 1024 * 1024,
        timeout: 120000, // 2 minute timeout
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      data = JSON.parse(jsonText);
      playlistTitle = data.title || data.playlist || 'Unknown Playlist';
      uploader = data.uploader || data.channel || undefined;
    } catch (error) {
      // Fallback to flat-playlist for large/problematic playlists
      console.log('  ⚠️  Large playlist detected, using alternative fetch method...');
      
      const flatCommand = `py -m yt_dlp --dump-json --flat-playlist ${cookiesArg} --no-warnings "${playlistUrl}"`;
      
      let output: string;
      try {
        output = execSync(flatCommand, {
          encoding: 'utf-8',
          maxBuffer: 200 * 1024 * 1024,
          timeout: 180000, // 3 minute timeout for large playlists
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (flatError: any) {
        // Capture stderr for better error messages
        const stderr = flatError.stderr?.toString() || '';
        if (stderr.includes('Private video') || stderr.includes('This video is private')) {
          throw new Error('Playlist contains private videos or requires authentication. Try using --cookies option.');
        } else if (stderr.includes('This playlist does not exist')) {
          throw new Error('Playlist not found or is private.');
        }
        throw new Error(`Failed to fetch playlist: ${stderr || flatError.message}`);
      }
      
      // Parse flat playlist output (one JSON per line)
      const lines = output.trim().split('\n').filter(line => line.length > 0 && line.startsWith('{'));
      
      if (lines.length === 0) {
        throw new Error('No videos found in playlist. It may be private or empty.');
      }
      
      // Build entries array from flat output
      const entries: any[] = [];
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          entries.push(item);
        } catch {
          continue;
        }
      }
      
      data = { entries };
      
      // Try to get playlist title from first video's playlist field
      if (entries.length > 0 && entries[0]?.playlist) {
        playlistTitle = entries[0].playlist;
      }
    }

    const entries: any[] = Array.isArray(data.entries) ? data.entries : [];
    
    if (entries.length === 0) {
      throw new Error('No videos found in playlist.');
    }

    // Map entries to Song[]; yt-dlp sometimes provides rich fields, sometimes flat
    const songs: Song[] = entries
      .filter((e) => !!e)
      .map((e) => {
        const thumb = Array.isArray(e.thumbnails) && e.thumbnails.length
          ? e.thumbnails[e.thumbnails.length - 1]?.url
          : (e.thumbnail || undefined);

        const duration = typeof e.duration === 'number'
          ? e.duration
          : (typeof e.duration_seconds === 'number' ? e.duration_seconds : 0);

        const artist = e.artist || e.channel || e.uploader || 'Unknown Artist';

        return {
          id: e.id || '',
          title: e.title || 'Unknown',
          artist,
          duration,
          coverUrl: thumb || undefined,
        } as Song;
      });

    const result: Playlist = {
      name: playlistTitle,
      songs,
      totalCount: songs.length,
    };
    
    if (uploader) {
      result.uploader = uploader;
    }
    
    return result;
  } catch (error) {
    throw new Error(`Failed to fetch playlist: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Gets detailed info for a single video
 */
export async function fetchSongDetails(videoId: string, cookiesFile?: string): Promise<Song> {
  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    const cookiesArg = cookiesFile ? `--cookies "${cookiesFile}"` : '';
    const command = `py -m yt_dlp ${cookiesArg} --dump-json "${videoUrl}"`;
    const output = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'], // Suppress stderr
    });

    const data = JSON.parse(output);

    return {
      id: videoId,
      title: data.title || 'Unknown',
      artist: data.channel || 'Unknown Artist',
      duration: data.duration || 0,
      coverUrl: data.thumbnail || undefined,
      downloadUrl: videoId,
    };
  } catch (error) {
    throw new Error(`Failed to fetch song details for ${videoId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
