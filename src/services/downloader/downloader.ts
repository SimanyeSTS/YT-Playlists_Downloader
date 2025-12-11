import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import PQueue from 'p-queue';
import { logger } from '../../utils/logger.js';
import { sanitizeFilename } from '../../utils/validator.js';
import type { Song, DownloadProgress } from '../../types/index.js';

// Set FFmpeg path
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
}

export interface DownloadOptions {
  outputDir: string;
  concurrency?: number;
  quality?: string;
  cookiesFile?: string;
  onProgress?: (progress: DownloadProgress) => void;
}

export interface DownloadResult {
  song: Song;
  filePath: string;
  success: boolean;
  error?: string;
}

/**
 * Downloads a single song with highest quality audio using yt-dlp
 */
async function downloadSong(
  song: Song,
  outputDir: string,
  cookiesFile?: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<DownloadResult> {
  const sanitizedTitle = sanitizeFilename(`${song.artist} - ${song.title}`);
  const outputPath = path.join(outputDir, `${sanitizedTitle}.mp3`);
  const tempAudioPath = path.join(outputDir, `${sanitizedTitle}.webm`);

  try {
    // Update progress: downloading
    onProgress?.({
      songId: song.id,
      title: song.title,
      status: 'downloading',
      progress: 0,
    });

    // Download with yt-dlp
    const videoUrl = `https://www.youtube.com/watch?v=${song.id}`;
    const cookiesArg = cookiesFile ? `--cookies "${cookiesFile}"` : '';
    const downloadCommand = `py -m yt_dlp -f "bestaudio[ext=webm]/bestaudio" ${cookiesArg} "${videoUrl}" -o "${tempAudioPath}" --no-warnings`;
    
    try {
      execSync(downloadCommand, {
        stdio: 'pipe', // Suppress output
      });
    } catch (err) {
      throw new Error(`yt-dlp download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // Convert to MP3 with FFmpeg
    await new Promise<void>((resolve, reject) => {
      onProgress?.({
        songId: song.id,
        title: song.title,
        status: 'converting',
        progress: 50,
      });

      ffmpeg(tempAudioPath)
        .audioBitrate(320)
        .audioCodec('libmp3lame')
        .format('mp3')
        .on('end', () => {
          // Clean up temp file
          if (fs.existsSync(tempAudioPath)) {
            fs.unlinkSync(tempAudioPath);
          }
          
          onProgress?.({
            songId: song.id,
            title: song.title,
            status: 'completed',
            progress: 100,
          });
          resolve();
        })
        .on('error', (err: Error) => {
          reject(err);
        })
        .save(outputPath);
    });

    return {
      song,
      filePath: outputPath,
      success: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Clean up temp file if it exists
    if (fs.existsSync(tempAudioPath)) {
      fs.unlinkSync(tempAudioPath);
    }
    
    onProgress?.({
      songId: song.id,
      title: song.title,
      status: 'failed',
      progress: 0,
      error: errorMessage,
    });

    logger.error(`Failed to download "${song.title}": ${errorMessage}`);

    return {
      song,
      filePath: '',
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Downloads multiple songs with concurrency control
 */
export async function downloadSongs(
  songs: Song[],
  options: DownloadOptions
): Promise<DownloadResult[]> {
  const { outputDir, concurrency = 5, cookiesFile, onProgress } = options;

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Create queue with concurrency limit
  const queue = new PQueue({ concurrency });
  const results: DownloadResult[] = [];

  logger.info(`Starting download of ${songs.length} songs with concurrency: ${concurrency}`);

  // Queue all downloads
  const downloadPromises = songs.map((song) =>
    queue.add(async () => {
      const result = await downloadSong(song, outputDir, cookiesFile, onProgress);
      results.push(result);
      return result;
    })
  );

  // Wait for all downloads to complete
  await Promise.all(downloadPromises);

  const successCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;

  logger.success(`Downloads complete: ${successCount} successful, ${failedCount} failed`);

  return results;
}
